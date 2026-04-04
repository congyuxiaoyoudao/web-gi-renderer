export default `
struct Uniforms {
    modelViewMatrix: mat4x4<f32>,
    numVertices: u32,
    paddedVertices: u32,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var<storage, read> positions: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read_write> distances: array<f32>;
@group(0) @binding(3) var<storage, read_write> indices: array<u32>;

@compute @workgroup_size(256)
fn compute_distances(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let idx = global_id.x;
    if (idx >= uniforms.paddedVertices) {
        return;
    }

    if (idx >= uniforms.numVertices) {
        distances[idx] = 10000000.0; // Infinity-like, will be sorted to the end
        indices[idx] = idx;
        return;
    }

    let pos = positions[idx].xyz;
    let viewPos = uniforms.modelViewMatrix * vec4<f32>(pos, 1.0);
    distances[idx] = viewPos.z;
    indices[idx] = idx;
}

struct SortUniforms {
    j: u32,
    k: u32,
};

@group(1) @binding(0) var<uniform> sort_uniforms: SortUniforms;

@compute @workgroup_size(256)
fn bitonic_sort(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let i = global_id.x;
    if (i >= uniforms.paddedVertices) {
        return;
    }

    let j = sort_uniforms.j;
    let k = sort_uniforms.k;

    let ixj = i ^ j;

    if (ixj > i) {
        let dist_i = distances[i];
        let dist_ixj = distances[ixj];

        let dir = (i & k) == 0u;

        if ((dist_i > dist_ixj) == dir) {
            distances[i] = dist_ixj;
            distances[ixj] = dist_i;

            let temp_idx = indices[i];
            indices[i] = indices[ixj];
            indices[ixj] = temp_idx;
        }
    }
}
`;
