//! The roof surface on this machine's GPU, read back: the sky above the
//! horizon, the green ground below it, and blue panels in the middle, at noon;
//! a darker, warmer sky near sunset. Skips, saying so, when no adapter exists.
//! `EXACT_GPU_OUT=<dir>` keeps the pictures as PPMs.

use exact_gpu::{fixture, Frame, Surface, Value};
use exact_solar_trial_gpu::{RoofSurface, REGISTRY};

fn inputs(sun: [f64; 3], intensity: f64, elevation: f64) -> Vec<Value> {
    // the 2 x 5 starting grid, as app.ts panelBoxes lays it out
    let mut boxes = Vec::new();
    for i in 0..10 {
        let (col, row) = ((i % 5) as f64, (i / 5) as f64);
        boxes.extend([(col - 2.0) * 2.68, (row - 0.5) * 5.12, 2.44, 4.88].map(Value::Number));
    }
    vec![Value::List(boxes.into()), Value::Number(sun[0]), Value::Number(sun[1]), Value::Number(sun[2]),
        Value::Number(intensity), Value::Number(elevation), Value::Number(30.0)]
}

#[test]
fn the_roof_draws_sky_ground_and_panels() {
    let Some(gpu) = fixture::device_or_skip(fixture::device()) else {
        return;
    };
    exact_gpu::shaders::load_dir(&exact_solar_trial_gpu::shader_dir(), &REGISTRY).unwrap();
    let frame = Frame {
        width: 195.0,
        height: 300.0,
        scale: 2.0,
        now_ms: 0.0,
        children_generation: 0,
        seekable: true,
        period_ms: 0.0,
        shader_generation: exact_gpu::shaders::shader_generation(),
        headroom: 1.0,
    };
    let mut roof = RoofSurface::default();
    roof.bind(&inputs([0.0, 12.0, 25.0], 3.1, 38.0), None).unwrap();
    let (noon, wants) = fixture::render(&gpu, &mut roof, &frame).unwrap();
    noon.save("roof-noon");
    assert!(!wants, "a still scene asks for no further frame");
    let [r, g, b, _] = noon.at(20, 20);
    assert!(b > r && b > 150, "the top is daytime sky, got {r} {g} {b}");
    let [r, g, b, _] = noon.at(20, 580);
    assert!(g > r && g > b, "the bottom is the green ground, got {r} {g} {b}");
    let blue = noon.count(|[r, g, b, _]| b as i32 > r as i32 + 60 && b as i32 > g as i32 + 20);
    assert!(blue > 2000, "the panels are blue, {blue} pixels");

    roof.bind(&inputs([19.5, 0.8, 25.0], 0.2, 2.0), None).unwrap();
    let (dusk, _) = fixture::render(&gpu, &mut roof, &frame).unwrap();
    dusk.save("roof-dusk");
    let [r, _, b, _] = dusk.at(20, 20);
    let [nr, _, nb, _] = noon.at(20, 20);
    assert!((r as i32 + b as i32) < (nr as i32 + nb as i32), "the dusk sky is darker");
}
