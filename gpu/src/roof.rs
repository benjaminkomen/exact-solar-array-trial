//! `roof(boxes, sunX, sunY, sunZ, intensity, elevation, tilt)`: SimulationScene's
//! camera, group transforms and colours, drawn with three small pipelines.

use crate::shaders::roof::{entry, module, GROUP_0};
use exact_gpu::json::{list, number};
use exact_gpu::wgpu;
use exact_gpu::{Frame, Surface, SurfaceError, Value};

type M4 = [f32; 16];

/// Column-major 4x4 helpers, enough for a camera and a few groups.
fn mul(a: &M4, b: &M4) -> M4 {
    let mut o = [0.0; 16];
    for c in 0..4 {
        for r in 0..4 {
            o[c * 4 + r] = (0..4).map(|k| a[k * 4 + r] * b[c * 4 + k]).sum();
        }
    }
    o
}
fn translate(x: f32, y: f32, z: f32) -> M4 {
    [1., 0., 0., 0., 0., 1., 0., 0., 0., 0., 1., 0., x, y, z, 1.]
}
fn scale(x: f32, y: f32, z: f32) -> M4 {
    [x, 0., 0., 0., 0., y, 0., 0., 0., 0., z, 0., 0., 0., 0., 1.]
}
fn rot_x(a: f32) -> M4 {
    let (s, c) = a.sin_cos();
    [1., 0., 0., 0., 0., c, s, 0., 0., -s, c, 0., 0., 0., 0., 1.]
}
fn rot_y(a: f32) -> M4 {
    let (s, c) = a.sin_cos();
    [c, 0., -s, 0., 0., 1., 0., 0., s, 0., c, 0., 0., 0., 0., 1.]
}
fn rot_z(a: f32) -> M4 {
    let (s, c) = a.sin_cos();
    [c, s, 0., 0., -s, c, 0., 0., 0., 0., 1., 0., 0., 0., 0., 1.]
}
fn sub(a: [f32; 3], b: [f32; 3]) -> [f32; 3] {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}
fn cross(a: [f32; 3], b: [f32; 3]) -> [f32; 3] {
    [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}
fn dot(a: [f32; 3], b: [f32; 3]) -> f32 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}
fn norm(a: [f32; 3]) -> [f32; 3] {
    let l = dot(a, a).sqrt().max(1e-6);
    [a[0] / l, a[1] / l, a[2] / l]
}
/// three.js Object3D.lookAt for a camera: -Z looks at the target.
fn view(eye: [f32; 3], at: [f32; 3]) -> M4 {
    let f = norm(sub(at, eye));
    let s = norm(cross(f, [0., 1., 0.]));
    let u = cross(s, f);
    [
        s[0], u[0], -f[0], 0., s[1], u[1], -f[1], 0., s[2], u[2], -f[2], 0.,
        -dot(s, eye), -dot(u, eye), dot(f, eye), 1.,
    ]
}
/// A WebGPU perspective (depth 0..1), vertical field of view in radians.
fn perspective(fovy: f32, aspect: f32, near: f32, far: f32) -> M4 {
    let f = 1.0 / (fovy / 2.0).tan();
    let nf = 1.0 / (near - far);
    [f / aspect, 0., 0., 0., 0., f, 0., 0., 0., 0., far * nf, -1., 0., 0., near * far * nf, 0.]
}
fn invert(m: &M4) -> M4 {
    // Gauss-Jordan on a 4x8; the camera matrix is always invertible.
    let mut a = [[0f32; 8]; 4];
    for r in 0..4 {
        for c in 0..4 {
            a[r][c] = m[c * 4 + r];
        }
        a[r][4 + r] = 1.0;
    }
    for i in 0..4 {
        let p = (i..4).max_by(|&x, &y| a[x][i].abs().total_cmp(&a[y][i].abs())).unwrap();
        a.swap(i, p);
        let d = a[i][i];
        for c in 0..8 {
            a[i][c] /= d;
        }
        for r in 0..4 {
            if r != i {
                let k = a[r][i];
                for c in 0..8 {
                    a[r][c] -= k * a[i][c];
                }
            }
        }
    }
    let mut o = [0.0; 16];
    for r in 0..4 {
        for c in 0..4 {
            o[c * 4 + r] = a[r][4 + c];
        }
    }
    o
}
fn hex(c: u32) -> [f32; 3] {
    [((c >> 16) & 255) as f32 / 255., ((c >> 8) & 255) as f32 / 255., (c & 255) as f32 / 255.]
}
fn mix(a: [f32; 3], b: [f32; 3], t: f32) -> [f32; 3] {
    [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
}

/// SkyDome's getHorizonAndZenith.
fn sky(el: f32) -> ([f32; 3], [f32; 3]) {
    let (night, twi, dawn, day) = (
        (hex(0x1a1a2e), hex(0x0a0a15)),
        (hex(0x4a3a5e), hex(0x1a1a3e)),
        (hex(0xc4856b), hex(0x4a6a8e)),
        (hex(0x9ec5d6), hex(0x4488cc)),
    );
    let lerp = |a: ([f32; 3], [f32; 3]), b: ([f32; 3], [f32; 3]), t: f32| (mix(a.0, b.0, t), mix(a.1, b.1, t));
    if el < -6.0 {
        night
    } else if el < 0.0 {
        lerp(night, twi, (el + 6.0) / 6.0)
    } else if el < 8.0 {
        lerp(twi, dawn, el / 8.0)
    } else if el < 20.0 {
        lerp(dawn, day, (el - 8.0) / 12.0)
    } else {
        day
    }
}

#[derive(Default)]
pub struct RoofSurface {
    boxes: Vec<[f32; 4]>,
    sun: [f32; 3],
    intensity: f32,
    elevation: f32,
    tilt: f32,
    gpu: Option<Gpu>,
}

struct Gpu {
    format: wgpu::TextureFormat,
    generation: u32,
    sky: wgpu::RenderPipeline,
    cubes: wgpu::RenderPipeline,
    sun: wgpu::RenderPipeline,
    layout: wgpu::BindGroupLayout,
    scene: wgpu::Buffer,
    storage: Option<(wgpu::Buffer, usize, wgpu::BindGroup)>,
    targets: Option<((u32, u32), wgpu::TextureView, wgpu::TextureView)>,
}

const SAMPLES: u32 = 1;
const DEPTH: wgpu::TextureFormat = wgpu::TextureFormat::Depth32Float;
const SCENE_BYTES: u64 = 16 * 4 * 2 + 16 * 6;

impl Surface for RoofSurface {
    fn bind(&mut self, inputs: &[Value], _: Option<f64>) -> Result<(), SurfaceError> {
        let [boxes, x, y, z, i, el, tilt] = inputs else {
            return Err(SurfaceError(format!("roof: expected 7 inputs, got {}", inputs.len())));
        };
        let flat: Vec<f32> = list(boxes, "boxes")?
            .iter()
            .map(|v| number(v, "boxes").map(|n| n as f32))
            .collect::<Result<_, _>>()?;
        self.boxes = flat.chunks_exact(4).map(|c| [c[0], c[1], c[2], c[3]]).collect();
        self.sun = [number(x, "sunX")? as f32, number(y, "sunY")? as f32, number(z, "sunZ")? as f32];
        self.intensity = number(i, "intensity")? as f32;
        self.elevation = number(el, "elevation")? as f32;
        self.tilt = number(tilt, "tilt")? as f32;
        Ok(())
    }

    fn opaque(&self) -> bool {
        true
    }

    fn render(
        &mut self,
        frame: &Frame,
        device: &wgpu::Device,
        queue: &wgpu::Queue,
        encoder: &mut wgpu::CommandEncoder,
        target: &wgpu::TextureView,
        format: wgpu::TextureFormat,
    ) -> bool {
        if self.gpu.as_ref().map(|g| (g.format, g.generation)) != Some((format, frame.shader_generation)) {
            self.gpu = Some(build(device, format, frame.shader_generation));
        }
        let (w, h) = frame.pixels();
        let (w, h) = (w.max(1), h.max(1));
        let cubes = self.cubes();
        let scene = self.scene(w as f32 / h as f32);
        let gpu = self.gpu.as_mut().unwrap();
        if gpu.targets.as_ref().map(|t| t.0) != Some((w, h)) {
            let tex = |label, format| {
                device
                    .create_texture(&wgpu::TextureDescriptor {
                        label: Some(label),
                        size: wgpu::Extent3d { width: w, height: h, depth_or_array_layers: 1 },
                        mip_level_count: 1,
                        sample_count: SAMPLES,
                        dimension: wgpu::TextureDimension::D2,
                        format,
                        usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
                        view_formats: &[],
                    })
                    .create_view(&Default::default())
            };
            gpu.targets = Some(((w, h), tex("roof msaa", format), tex("roof depth", DEPTH)));
        }
        let bytes: Vec<u8> = cubes.iter().flatten().flat_map(|f| f.to_le_bytes()).collect();
        if gpu.storage.as_ref().map_or(true, |s| s.1 < cubes.len()) {
            let buffer = device.create_buffer(&wgpu::BufferDescriptor {
                label: Some("roof cubes"),
                size: (cubes.len().max(8) * 80) as u64,
                usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_DST,
                mapped_at_creation: false,
            });
            let group = device.create_bind_group(&wgpu::BindGroupDescriptor {
                label: Some("roof"),
                layout: &gpu.layout,
                entries: &[
                    wgpu::BindGroupEntry { binding: 0, resource: gpu.scene.as_entire_binding() },
                    wgpu::BindGroupEntry { binding: 1, resource: buffer.as_entire_binding() },
                ],
            });
            gpu.storage = Some((buffer, cubes.len().max(8), group));
        }
        let (buffer, _, group) = gpu.storage.as_ref().unwrap();
        queue.write_buffer(buffer, 0, &bytes);
        queue.write_buffer(&gpu.scene, 0, &scene.iter().flat_map(|f| f.to_le_bytes()).collect::<Vec<u8>>());
        let (_, msaa, depth) = gpu.targets.as_ref().unwrap();
        let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
            label: Some("roof"),
            color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                view: if SAMPLES > 1 { msaa } else { target },
                resolve_target: if SAMPLES > 1 { Some(target) } else { None },
                depth_slice: None,
                ops: wgpu::Operations {
                    load: wgpu::LoadOp::Clear(wgpu::Color::BLACK),
                    store: if SAMPLES > 1 { wgpu::StoreOp::Discard } else { wgpu::StoreOp::Store },
                },
            })],
            depth_stencil_attachment: Some(wgpu::RenderPassDepthStencilAttachment {
                view: depth,
                depth_ops: Some(wgpu::Operations { load: wgpu::LoadOp::Clear(1.0), store: wgpu::StoreOp::Discard }),
                stencil_ops: None,
            }),
            timestamp_writes: None,
            occlusion_query_set: None,
            multiview_mask: None,
        });
        pass.set_bind_group(0, group, &[]);
        pass.set_pipeline(&gpu.sky);
        pass.draw(0..3, 0..1);
        pass.set_pipeline(&gpu.cubes);
        pass.draw(0..36, 0..cubes.len() as u32);
        pass.set_pipeline(&gpu.sun);
        pass.draw(0..6, 0..1);
        // Inputs change the picture; nothing else does.
        false
    }
}

impl RoofSurface {
    /// The ground, the roof slab and the panels, each a unit cube's model matrix and colour.
    fn cubes(&self) -> Vec<[f32; 20]> {
        let cube = |m: M4, rgb: [f32; 3], emissive: f32| {
            let mut o = [0.0; 20];
            o[..16].copy_from_slice(&m);
            o[16..19].copy_from_slice(&rgb);
            o[19] = emissive;
            o
        };
        let mut out = vec![cube(mul(&translate(0., -0.05, 0.), &scale(200., 0.1, 200.)), hex(0x7a9e78), 0.0)];
        if self.boxes.is_empty() {
            return out;
        }
        let near = self.boxes.iter().map(|b| b[1] - b[3] / 2.).fold(f32::MAX, f32::min);
        let far = self.boxes.iter().map(|b| b[1] + b[3] / 2.).fold(f32::MIN, f32::max);
        let min_x = self.boxes.iter().map(|b| b[0] - b[2] / 2.).fold(f32::MAX, f32::min);
        let max_x = self.boxes.iter().map(|b| b[0] + b[2] / 2.).fold(f32::MIN, f32::max);
        // <group position=[5,2,20]><group z=near><group rotation=[-tilt,-0.5,0.5]><group [0,3,-near]>
        let tilt = -self.tilt.to_radians();
        let group = [translate(5., 2., 20.), translate(0., 0., near), rot_x(tilt), rot_y(-0.5), rot_z(0.5), translate(0., 3., -near)]
            .iter()
            .fold(translate(0., 0., 0.), |m, t| mul(&m, t));
        let roof = mul(&translate((min_x + max_x) / 2., -0.06, (near + far) / 2.), &scale(max_x - min_x + 0.6, 0.04, far - near + 0.6));
        out.push(cube(mul(&group, &roof), hex(0x555555), 0.0));
        // SolarPanelMesh: #3b82f6, emissive #1a4080 x 0.4 (about a fifth of the colour)
        for b in &self.boxes {
            out.push(cube(mul(&group, &mul(&translate(b[0], 0., b[1]), &scale(b[2], 0.05, b[3]))), hex(0x3b82f6), 0.22));
        }
        out
    }

    fn scene(&self, aspect: f32) -> Vec<f32> {
        let eye = [0., 8., -8.];
        let vp = mul(&perspective(75f32.to_radians(), aspect, 0.1, 1000.), &view(eye, [0., 4., 20.]));
        let (horizon, zenith) = sky(self.elevation);
        let t = (self.elevation / 30.).clamp(0., 1.);
        let light = mix(hex(0xffcc88), hex(0xfff4e6), t);
        let i = self.intensity.max(0.);
        let ambient = 0.1 + (self.elevation / 90.).max(0.) * 0.15;
        let opacity = if self.sun[1] > 0. { (self.sun[1] / 3.).min(1.) } else { 0. };
        let mut s = Vec::with_capacity(SCENE_BYTES as usize / 4);
        s.extend_from_slice(&vp);
        s.extend_from_slice(&invert(&vp));
        s.extend_from_slice(&[self.sun[0], self.sun[1], self.sun[2], opacity]);
        s.extend_from_slice(&[light[0] * i, light[1] * i, light[2] * i, ambient * 2.0]);
        s.extend_from_slice(&[horizon[0], horizon[1], horizon[2], 1.]);
        s.extend_from_slice(&[zenith[0], zenith[1], zenith[2], 1.]);
        s.extend_from_slice(&[eye[0], eye[1], eye[2], 0.012]);
        let fog = hex(0x9ab8a8);
        s.extend_from_slice(&[fog[0], fog[1], fog[2], 1.]);
        s
    }
}

fn build(device: &wgpu::Device, format: wgpu::TextureFormat, generation: u32) -> Gpu {
    let shader = device.create_shader_module(module());
    let layout = device.create_bind_group_layout(&GROUP_0);
    let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
        label: Some("roof"),
        bind_group_layouts: &[Some(&layout)],
        immediate_size: 0,
    });
    let pipeline = |vs: &str, fs: &str, depth_write: bool, compare: wgpu::CompareFunction, blend: Option<wgpu::BlendState>| {
        device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some(vs),
            layout: Some(&pipeline_layout),
            vertex: wgpu::VertexState { module: &shader, entry_point: Some(vs), buffers: &[], compilation_options: Default::default() },
            fragment: Some(wgpu::FragmentState {
                module: &shader,
                entry_point: Some(fs),
                targets: &[Some(wgpu::ColorTargetState { format, blend, write_mask: wgpu::ColorWrites::ALL })],
                compilation_options: Default::default(),
            }),
            primitive: Default::default(),
            depth_stencil: Some(wgpu::DepthStencilState {
                format: DEPTH,
                depth_write_enabled: Some(depth_write),
                depth_compare: Some(compare),
                stencil: Default::default(),
                bias: Default::default(),
            }),
            multisample: wgpu::MultisampleState { count: SAMPLES, ..Default::default() },
            multiview_mask: None,
            cache: None,
        })
    };
    Gpu {
        format,
        generation,
        sky: pipeline(entry::VS_SKY, entry::FS_SKY, false, wgpu::CompareFunction::Always, None),
        cubes: pipeline(entry::VS_CUBE, entry::FS_CUBE, true, wgpu::CompareFunction::Less, None),
        sun: pipeline(entry::VS_SUN, entry::FS_SUN, false, wgpu::CompareFunction::Less, Some(wgpu::BlendState::PREMULTIPLIED_ALPHA_BLENDING)),
        layout,
        scene: device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("roof scene"),
            size: SCENE_BYTES,
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        }),
        storage: None,
        targets: None,
    }
}
