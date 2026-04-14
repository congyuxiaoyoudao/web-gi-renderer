export default `
struct ViewParams {
    projection: mat4x4<f32>,
    modelView: mat4x4<f32>,
    screenSize: vec2<f32>,
    splatRadius: f32,
};

@group(0) @binding(0) var<uniform> projection: mat4x4<f32>;
@group(0) @binding(1) var<uniform> modelView: mat4x4<f32>;
@group(0) @binding(2) var<uniform> screenSize: vec2<f32>;
@group(0) @binding(3) var<uniform> splatRadius: f32;

@group(1) @binding(0) var<storage, read> positions: array<vec4<f32>>;
@group(1) @binding(1) var<storage, read> cov3d_buffer: array<vec4<f32>>;
@group(1) @binding(2) var<storage, read> colors: array<vec4<f32>>;

// Depth texture and sampler for depth testing against Three.js scene
@group(2) @binding(0) var depthTexture: texture_depth_2d;
@group(2) @binding(1) var depthSampler: sampler_comparison;

struct VertexOutput {
    @builtin(position) clip_position: vec4<f32>,
    @location(0) color: vec4<f32>,
    @location(1) uv: vec2<f32>,
    @location(2) ndc_depth: f32,
};

@vertex
fn vs_main(
    @location(0) splatPos: vec2<f32>,
    @location(1) splatId: u32,
) -> VertexOutput {
    var out: VertexOutput;

    let pos3d = positions[splatId].xyz;
    let viewPos = modelView * vec4<f32>(pos3d, 1.0);
    let clipPos = projection * viewPos;

    // Store NDC depth for depth texture comparison
    // WebGPU NDC depth is in [0, 1] range after perspective divide
    out.ndc_depth = clipPos.z / clipPos.w;

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
    // clip space is [-1, 1] x [-1, 1]
    let offset_clip = (offset_pixels / screenSize) * 2.0 * clipPos.w;

    out.clip_position = vec4<f32>(clipPos.xy + offset_clip, clipPos.z, clipPos.w);
    out.color = colors[splatId];
    out.uv = splatPos;

    return out;
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
    let d = dot(in.uv * 2.0, in.uv * 2.0);
    if (d > 4.0) {
        discard;
    }

    // Depth test: compare splat depth against stored depth from Three.js scene
    // Convert clip position to UV coordinates [0, 1]
    let uv = in.clip_position.xy * 0.5 + 0.5;

    // Sample depth texture and compare
    // textureSampleCompareLevel returns 1.0 if depth test passes, 0.0 otherwise
    // We use less-equal comparison: splat passes if its depth <= stored depth
    let depthCompare = textureSampleCompareLevel(depthTexture, depthSampler, uv, in.ndc_depth);

    // If depth test fails (stored depth is closer), discard this fragment
    if (depthCompare == 0.0) {
        discard;
    }

    let alpha = exp(-d) * in.color.a;
    return vec4<f32>(in.color.rgb * alpha, alpha);
}
`;
