export default `
struct ViewParams {
    projection: mat4x4<f32>,
    modelView: mat4x4<f32>,
    screenSize: vec2<f32>,
    splatRadius: f32,
    debugDepth: f32,
};

@group(0) @binding(0) var<uniform> projection: mat4x4<f32>;
@group(0) @binding(1) var<uniform> modelView: mat4x4<f32>;
@group(0) @binding(2) var<uniform> screenSize: vec2<f32>;
@group(0) @binding(3) var<uniform> splatRadius: f32;
@group(0) @binding(4) var<uniform> debugDepth: f32;
@group(0) @binding(5) var<uniform> sh_degree: u32;
@group(0) @binding(6) var<uniform> cam_pos_model: vec4<f32>;

@group(1) @binding(0) var<storage, read> positions: array<vec4<f32>>;
@group(1) @binding(1) var<storage, read> cov3d_buffer: array<vec4<f32>>;
@group(1) @binding(2) var<storage, read> colors: array<vec4<f32>>;
// Tight-packed f32 storage: 15 higher-order basis × 3 channels = 45 floats per splat.
// Layout: [R_b, G_b, B_b] for b = 0..14 (no DC, no padding).
@group(1) @binding(3) var<storage, read> sh_buffer: array<f32>;

struct VertexOutput {
    @builtin(position) clip_position: vec4<f32>,
    @location(0) color: vec4<f32>,
    @location(1) uv: vec2<f32>,
};

// Evaluate higher-order SH contributions (degrees 1-3) and add to the baked DC color.
// sh_buffer: 45 f32 per splat — [R,G,B] for each of 15 basis functions.
fn eval_sh_higher(splatId: u32, dir: vec3<f32>, degree: u32) -> vec3<f32> {
    const C1: f32 = 0.4886025119029199;
    const C2_0: f32 =  1.0925484305920792;
    const C2_1: f32 = -1.0925484305920792;
    const C2_2: f32 =  0.31539156525252005;
    const C2_3: f32 = -1.0925484305920792;
    const C2_4: f32 =  0.5462742152960396;
    const C3_0: f32 = -0.5900435899266435;
    const C3_1: f32 =  2.890611442640554;
    const C3_2: f32 = -0.4570457994644658;
    const C3_3: f32 =  0.3731763325901154;
    const C3_4: f32 = -0.4570457994644658;
    const C3_5: f32 =  1.445305721320277;
    const C3_6: f32 = -0.5900435899266435;

    let base = splatId * 45u;
    var rgb = vec3<f32>(0.0);

    if (degree >= 1u) {
        let x = dir.x; let y = dir.y; let z = dir.z;
        let sh0 = vec3<f32>(sh_buffer[base +  0u], sh_buffer[base +  1u], sh_buffer[base +  2u]);
        let sh1 = vec3<f32>(sh_buffer[base +  3u], sh_buffer[base +  4u], sh_buffer[base +  5u]);
        let sh2 = vec3<f32>(sh_buffer[base +  6u], sh_buffer[base +  7u], sh_buffer[base +  8u]);
        rgb += C1 * (-y * sh0 + z * sh1 - x * sh2);

        if (degree >= 2u) {
            let xx = x*x; let yy = y*y; let zz = z*z;
            let xy = x*y; let yz = y*z; let xz = x*z;
            let sh3 = vec3<f32>(sh_buffer[base +  9u], sh_buffer[base + 10u], sh_buffer[base + 11u]);
            let sh4 = vec3<f32>(sh_buffer[base + 12u], sh_buffer[base + 13u], sh_buffer[base + 14u]);
            let sh5 = vec3<f32>(sh_buffer[base + 15u], sh_buffer[base + 16u], sh_buffer[base + 17u]);
            let sh6 = vec3<f32>(sh_buffer[base + 18u], sh_buffer[base + 19u], sh_buffer[base + 20u]);
            let sh7 = vec3<f32>(sh_buffer[base + 21u], sh_buffer[base + 22u], sh_buffer[base + 23u]);
            rgb += C2_0 * xy                 * sh3
                 + C2_1 * yz                 * sh4
                 + C2_2 * (2.0*zz - xx - yy) * sh5
                 + C2_3 * xz                 * sh6
                 + C2_4 * (xx - yy)          * sh7;

            if (degree >= 3u) {
                let sh8  = vec3<f32>(sh_buffer[base + 24u], sh_buffer[base + 25u], sh_buffer[base + 26u]);
                let sh9  = vec3<f32>(sh_buffer[base + 27u], sh_buffer[base + 28u], sh_buffer[base + 29u]);
                let sh10 = vec3<f32>(sh_buffer[base + 30u], sh_buffer[base + 31u], sh_buffer[base + 32u]);
                let sh11 = vec3<f32>(sh_buffer[base + 33u], sh_buffer[base + 34u], sh_buffer[base + 35u]);
                let sh12 = vec3<f32>(sh_buffer[base + 36u], sh_buffer[base + 37u], sh_buffer[base + 38u]);
                let sh13 = vec3<f32>(sh_buffer[base + 39u], sh_buffer[base + 40u], sh_buffer[base + 41u]);
                let sh14 = vec3<f32>(sh_buffer[base + 42u], sh_buffer[base + 43u], sh_buffer[base + 44u]);
                rgb += C3_0 * y*(3.0*xx - yy)              * sh8
                     + C3_1 * xy*z                          * sh9
                     + C3_2 * y*(4.0*zz - xx - yy)         * sh10
                     + C3_3 * z*(2.0*zz - 3.0*xx - 3.0*yy) * sh11
                     + C3_4 * x*(4.0*zz - xx - yy)         * sh12
                     + C3_5 * z*(xx - yy)                  * sh13
                     + C3_6 * x*(xx - 3.0*yy)              * sh14;
            }
        }
    }
    return rgb;
}

@vertex
fn vs_main(
    @location(0) splatPos: vec2<f32>,
    @location(1) splatId: u32,
) -> VertexOutput {
    var out: VertexOutput;

    let pos3d = positions[splatId].xyz;
    let viewPos = modelView * vec4<f32>(pos3d, 1.0);
    let clipPos = projection * viewPos;

    // Read 3D covariance
    let cov_part1 = cov3d_buffer[splatId * 2];
    let cov_part2 = cov3d_buffer[splatId * 2 + 1];

    let cov3d = mat3x3<f32>(
        vec3<f32>(cov_part1.x, cov_part1.y, cov_part1.z),
        vec3<f32>(cov_part1.y, cov_part1.w, cov_part2.x),
        vec3<f32>(cov_part1.z, cov_part2.x, cov_part2.y)
    );

    // Compute 2D basis
    let focal_x = projection[0][0] * screenSize.x * 0.5;
    let focal_y = projection[1][1] * screenSize.y * 0.5;

    let s = 1.0 / (viewPos.z * viewPos.z);
    let J = mat3x3<f32>(
        vec3<f32>(-focal_x / viewPos.z, 0.0, (focal_x * viewPos.x) * s),
        vec3<f32>(0.0, -focal_y / viewPos.z, (focal_y * viewPos.y) * s),
        vec3<f32>(0.0, 0.0, 0.0)
    );

    let W = transpose(mat3x3<f32>(
        modelView[0].xyz,
        modelView[1].xyz,
        modelView[2].xyz
    ));

    let T = W * J;
    let newC = transpose(T) * (cov3d * T);

    let c_xx = newC[0][0];
    let c_xy = newC[0][1];
    let c_yy = newC[1][1];

    let D = c_xx * c_yy - c_xy * c_xy;
    let trace = c_xx + c_yy;
    let traceOver2 = trace / 2.0;
    let term2 = sqrt(max(0.0, traceOver2 * traceOver2 - D));
    let lambda_1 = traceOver2 + term2;
    let lambda_2 = max(traceOver2 - term2, 0.0);

    var eigenVector_1 = vec2<f32>(c_xy, lambda_1 - c_xx);
    if (length(eigenVector_1) == 0.0) {
        eigenVector_1 = vec2<f32>(1.0, 0.0);
    } else {
        eigenVector_1 = normalize(eigenVector_1);
    }
    let eigenVector_2 = vec2<f32>(eigenVector_1.y, -eigenVector_1.x);

    let maxSplatRadius = 1024.0;
    let basis1 = eigenVector_1 * min(sqrt(lambda_1) * 4.0 * splatRadius, maxSplatRadius);
    let basis2 = eigenVector_2 * min(sqrt(lambda_2) * 4.0 * splatRadius, maxSplatRadius);

    // splatPos is in [-1, 1]
    let offset_pixels = splatPos.x * basis1 + splatPos.y * basis2;

    // Convert pixels to clip space
    let offset_clip = (offset_pixels / screenSize) * 2.0 * clipPos.w;

    out.clip_position = vec4<f32>(clipPos.xy + offset_clip, clipPos.z, clipPos.w);

    // Compute view-dependent color: baked DC + higher-order SH contribution
    if (sh_degree == 0u) {
        out.color = colors[splatId];
    } else {
        let view_dir = normalize(pos3d - cam_pos_model.xyz);
        let rgb_higher = eval_sh_higher(splatId, view_dir, sh_degree);
        let rgb = clamp(colors[splatId].rgb + rgb_higher, vec3<f32>(0.0), vec3<f32>(1.0));
        out.color = vec4<f32>(rgb, colors[splatId].a);
    }

    out.uv = splatPos;

    return out;
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
    let d = dot(in.uv * 2.0, in.uv * 2.0);
    if (d > 4.0) {
        discard;
    }

        // Debug visualization - show splat depth as grayscale
    if (debugDepth > 0.5) {
        let depth = in.clip_position.z / in.clip_position.w;  // WebGPU NDC depth is already in [0, 1]
        return vec4<f32>(depth, depth, depth, 1.0);
    }

    let alpha = exp(-d) * in.color.a;
    return vec4<f32>(in.color.rgb * alpha, alpha);
}
`;
