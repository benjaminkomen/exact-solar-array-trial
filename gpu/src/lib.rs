//! The 3D simulation's GPU module (LLP 1009): the `roof` surface. A minimal
//! wgpu renderer of the RN Simulation scene: sky gradient, ground, the tilted
//! roof slab, the panels as boxes lit by the sun, and the sun's glow.
//! The sun, the hour and the season are computed in the data module (app.ts
//! `simulate`); the canvas's arguments carry the result.

pub mod roof;
pub use roof::RoofSurface;

use exact_gpu::{Registry, Surface};

/// The shaders under `shaders/`, reflected at build (`build.rs`).
pub mod shaders {
    include!(concat!(env!("OUT_DIR"), "/shaders.rs"));
}

/// Where this crate's shaders live, for a fixture.
#[cfg(not(target_arch = "wasm32"))]
pub fn shader_dir() -> std::path::PathBuf {
    std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("shaders")
}

fn roof() -> Box<dyn Surface> {
    Box::new(RoofSurface::default())
}

/// The module's surfaces and the shaders they bind against.
pub static REGISTRY: Registry = Registry {
    surfaces: &[("roof", 7, roof)],
    shaders: shaders::SHADERS,
};

exact_gpu::module!(REGISTRY);
