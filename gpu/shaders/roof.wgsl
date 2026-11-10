// The 3D simulation (the RN SimulationScene, reduced): a sky gradient, lit boxes
// (the ground, the roof slab and the panels) and the sun as a glowing billboard.
// Three pipelines share this module: sky, boxes, sun.
struct Scene {
    view_proj: mat4x4<f32>,
    inv_view_proj: mat4x4<f32>,
    // xyz: the sun's world position; w: its opacity (fades near the horizon)
    sun_pos: vec4<f32>,
    // rgb: the directional light's colour times its intensity; w: the ambient
    sun_color: vec4<f32>,
    horizon: vec4<f32>,
    zenith: vec4<f32>,
    // xyz: the camera; w: the fog density
    camera: vec4<f32>,
    fog: vec4<f32>,
}

// A unit cube [-0.5, 0.5]^3 placed by `model`; rgb its colour, a its emissive share.
struct Cube {
    model: mat4x4<f32>,
    color: vec4<f32>,
}

@group(0) @binding(0) var<uniform> scene: Scene;
@group(0) @binding(1) var<storage, read> cubes: array<Cube>;

struct SkyOut {
    @builtin(position) position: vec4<f32>,
    @location(0) ndc: vec2<f32>,
}

@vertex
fn vs_sky(@builtin(vertex_index) i: u32) -> SkyOut {
    let p = vec2<f32>(f32((i << 1u) & 2u), f32(i & 2u)) * 2.0 - 1.0;
    var out: SkyOut;
    out.position = vec4<f32>(p, 1.0, 1.0);
    out.ndc = p;
    return out;
}

@fragment
fn fs_sky(f: SkyOut) -> @location(0) vec4<f32> {
    let far = scene.inv_view_proj * vec4<f32>(f.ndc, 1.0, 1.0);
    let dir = normalize(far.xyz / far.w - scene.camera.xyz);
    let t = clamp(dir.y, 0.0, 1.0);
    return vec4<f32>(mix(scene.horizon.rgb, scene.zenith.rgb, t), 1.0);
}

struct CubeOut {
    @builtin(position) position: vec4<f32>,
    @location(0) world: vec3<f32>,
    @location(1) normal: vec3<f32>,
    @location(2) color: vec4<f32>,
}

@vertex
fn vs_cube(@builtin(vertex_index) v: u32, @builtin(instance_index) n: u32) -> CubeOut {
    // 6 faces x 2 triangles; face f has normal axis f / 2, sign from f % 2.
    let face = v / 6u;
    let corner = array<vec2<f32>, 6>(
        vec2<f32>(-0.5, -0.5), vec2<f32>(0.5, -0.5), vec2<f32>(0.5, 0.5),
        vec2<f32>(-0.5, -0.5), vec2<f32>(0.5, 0.5), vec2<f32>(-0.5, 0.5))[v % 6u];
    let s = select(-1.0, 1.0, (face & 1u) == 0u);
    var p: vec3<f32>;
    var nrm: vec3<f32>;
    let axis = face / 2u;
    // Winding is counter-clockwise seen from outside for every face.
    if axis == 0u {
        p = vec3<f32>(0.5 * s, corner.x, corner.y * s);
        nrm = vec3<f32>(s, 0.0, 0.0);
    } else if axis == 1u {
        p = vec3<f32>(corner.y * s, 0.5 * s, corner.x);
        nrm = vec3<f32>(0.0, s, 0.0);
    } else {
        p = vec3<f32>(corner.x * s, corner.y, 0.5 * s);
        nrm = vec3<f32>(0.0, 0.0, s);
    }
    let c = cubes[n];
    let world = c.model * vec4<f32>(p, 1.0);
    var out: CubeOut;
    out.position = scene.view_proj * world;
    out.world = world.xyz;
    out.normal = normalize((c.model * vec4<f32>(nrm, 0.0)).xyz);
    out.color = c.color;
    return out;
}

@fragment
fn fs_cube(f: CubeOut) -> @location(0) vec4<f32> {
    // A three.js DirectionalLight: from its position toward the origin, the same everywhere.
    let l = normalize(scene.sun_pos.xyz);
    // Double-sided, as the RN materials are: light whichever side faces the camera.
    var n = normalize(f.normal);
    if dot(n, scene.camera.xyz - f.world) < 0.0 {
        n = -n;
    }
    let diffuse = max(dot(n, l), 0.0);
    let base = f.color.rgb;
    let lit = base * (scene.sun_color.w + scene.sun_color.rgb * diffuse * 0.32) + base * f.color.a;
    let d = distance(f.world, scene.camera.xyz) * scene.camera.w;
    let fog = 1.0 - exp(-d * d);
    return vec4<f32>(mix(lit, scene.fog.rgb, fog), 1.0);
}

struct SunOut {
    @builtin(position) position: vec4<f32>,
    @location(0) uv: vec2<f32>,
}

@vertex
fn vs_sun(@builtin(vertex_index) v: u32) -> SunOut {
    let corner = array<vec2<f32>, 6>(
        vec2<f32>(-1.0, -1.0), vec2<f32>(1.0, -1.0), vec2<f32>(1.0, 1.0),
        vec2<f32>(-1.0, -1.0), vec2<f32>(1.0, 1.0), vec2<f32>(-1.0, 1.0))[v];
    // A camera-facing quad: the glow is 4x the sphere's radius of 2.
    let to_cam = normalize(scene.camera.xyz - scene.sun_pos.xyz);
    let right = normalize(cross(vec3<f32>(0.0, 1.0, 0.0), to_cam));
    let up = cross(to_cam, right);
    let world = scene.sun_pos.xyz + (right * corner.x + up * corner.y) * 8.0;
    var out: SunOut;
    out.position = scene.view_proj * vec4<f32>(world, 1.0);
    out.uv = corner;
    return out;
}

@fragment
fn fs_sun(f: SunOut) -> @location(0) vec4<f32> {
    let r = length(f.uv) * 4.0;
    // the disc (radius 1 in sphere units, softened) and a bloom-like falloff
    let disc = 1.0 - smoothstep(0.9, 1.05, r);
    let glow = pow(max(1.0 - r / 4.0, 0.0), 2.5) * 0.55;
    let a = clamp(disc + glow, 0.0, 1.0) * scene.sun_pos.w;
    let warm = vec3<f32>(1.0, 0.86, 0.6);
    let rgb = mix(warm, vec3<f32>(1.0, 0.98, 0.92), disc);
    return vec4<f32>(rgb * a, a);
}
