export interface GaussianBuffers {
    positions: Float32Array;  // [x, y, z, padding] * count
    cov3d: Float32Array;      // [c_xx, c_xy, c_xz, c_yy, c_yz, c_zz, 0, 0] * count
    colors: Float32Array;     // [r, g, b, opacity] * count (degree-0 pre-baked + opacity)
    // 16 vec4(R,G,B,0) per splat: index 0 = DC, 1-3 = deg1, 4-8 = deg2, 9-15 = deg3
    shCoeffs: Float32Array;
    maxSHDegree: number;
    count: number;
}

export class PlyLoader {
    private header: string[] = [];
    private format: string = '';
    private numVertices: number = 0;
    private properties: { name: string; type: string; offset?: number }[] = [];
    private headerLength: number = 0;
    private vertexStride: number = 0;

    async loadFromUrl(url: string): Promise<GaussianBuffers> {
        const response = await fetch(url);
        const arrayBuffer = await response.arrayBuffer();
        return this.parsePly(arrayBuffer);
    }

    async parsePly(buffer: ArrayBuffer): Promise<GaussianBuffers> {
        this.parseHeader(buffer);

        if (this.format === 'binary_little_endian') {
            return this.parseBinary(buffer);
        } else if (this.format === 'ascii') {
            return this.parseASCII(buffer);
        } else {
            throw new Error(`Unsupported PLY format: ${this.format}`);
        }
    }

    private parseHeader(buffer: ArrayBuffer): void {
        const decoder = new TextDecoder();
        const chunk = new Uint8Array(buffer, 0, Math.min(2048, buffer.byteLength));
        const headerText = decoder.decode(chunk);

        const headerEndIndex = headerText.indexOf('end_header\n');
        if (headerEndIndex === -1) {
            throw new Error('Invalid PLY file: Cannot find end of header');
        }
        this.headerLength = headerEndIndex + 11; // 'end_header\n' 的长度

        const headerLines = headerText.slice(0, headerEndIndex).split('\n').map(line => line.trim());
        let i = 0;

        if (headerLines[i] !== 'ply') {
            throw new Error('Invalid PLY file: Missing "ply" header');
        }

        i++;
        let currentPropertyOffset = 0;

        while (i < headerLines.length) {
            const line = headerLines[i];
            this.header.push(line);

            if (line.startsWith('format')) {
                this.format = line.split(' ')[1];
            } else if (line.startsWith('element vertex')) {
                this.numVertices = parseInt(line.split(' ')[2]);
            } else if (line.startsWith('property')) {
                const parts = line.split(' ');
                const prop = {
                    name: parts[2],
                    type: parts[1],
                    offset: currentPropertyOffset
                };
                this.properties.push(prop);
                currentPropertyOffset += this.getTypeSize(prop.type);
            }

            i++;
        }

        this.vertexStride = currentPropertyOffset;
    }

    private parseBinary(buffer: ArrayBuffer): GaussianBuffers {
        const dataView = new DataView(buffer);
        const SH_C0 = 0.28209479177387814;

        const positions = new Float32Array(this.numVertices * 4);
        const cov3d = new Float32Array(this.numVertices * 8);
        const colors = new Float32Array(this.numVertices * 4);

        let offset = this.headerLength;

        const getPropertyOffset = (name: string): number => {
            const prop = this.properties.find(p => p.name === name);
            return prop?.offset ?? -1;
        };

        const x_offset = getPropertyOffset('x');
        const y_offset = getPropertyOffset('y');
        const z_offset = getPropertyOffset('z');
        const rot_0_offset = getPropertyOffset('rot_0');
        const rot_1_offset = getPropertyOffset('rot_1');
        const rot_2_offset = getPropertyOffset('rot_2');
        const rot_3_offset = getPropertyOffset('rot_3');
        const scale_0_offset = getPropertyOffset('scale_0');
        const scale_1_offset = getPropertyOffset('scale_1');
        const scale_2_offset = getPropertyOffset('scale_2');
        const f_dc_0_offset = getPropertyOffset('f_dc_0');
        const f_dc_1_offset = getPropertyOffset('f_dc_1');
        const f_dc_2_offset = getPropertyOffset('f_dc_2');
        const opacity_offset = getPropertyOffset('opacity');

        // Detect higher-order SH coefficients (f_rest_0..N)
        const fRestCount = this.properties.filter(p => p.name.startsWith('f_rest_')).length;
        const fRestOffsets: number[] = [];
        for (let i = 0; i < fRestCount; i++) {
            fRestOffsets.push(getPropertyOffset(`f_rest_${i}`));
        }
        const perChannel = Math.floor(fRestCount / 3);
        let maxSHDegree = 0;
        if (perChannel >= 3) maxSHDegree = 1;
        if (perChannel >= 8) maxSHDegree = 2;
        if (perChannel >= 15) maxSHDegree = 3;

        // 15 higher-order basis × 3 channels = 45 floats per splat (no DC, no padding)
        // layout: [R_b, G_b, B_b] for b=0..14 (deg1: 0-2, deg2: 3-7, deg3: 8-14)
        const shCoeffs = new Float32Array(this.numVertices * 45);

        for (let v = 0; v < this.numVertices; v++) {
            const baseOffset = this.headerLength + v * this.vertexStride;

            const x = dataView.getFloat32(baseOffset + x_offset, true);
            const y = dataView.getFloat32(baseOffset + y_offset, true);
            const z = dataView.getFloat32(baseOffset + z_offset, true);

            const rot_0 = dataView.getFloat32(baseOffset + rot_0_offset, true);
            const rot_1 = dataView.getFloat32(baseOffset + rot_1_offset, true);
            const rot_2 = dataView.getFloat32(baseOffset + rot_2_offset, true);
            const rot_3 = dataView.getFloat32(baseOffset + rot_3_offset, true);

            const scale_0 = Math.exp(dataView.getFloat32(baseOffset + scale_0_offset, true));
            const scale_1 = Math.exp(dataView.getFloat32(baseOffset + scale_1_offset, true));
            const scale_2 = Math.exp(dataView.getFloat32(baseOffset + scale_2_offset, true));

            const f_dc_0 = dataView.getFloat32(baseOffset + f_dc_0_offset, true);
            const f_dc_1 = dataView.getFloat32(baseOffset + f_dc_1_offset, true);
            const f_dc_2 = dataView.getFloat32(baseOffset + f_dc_2_offset, true);

            const opacity = 1.0 / (1.0 + Math.exp(-dataView.getFloat32(baseOffset + opacity_offset, true)));

            // write positions [x, y, z, padding]
            positions[v * 4 + 0] = x;
            positions[v * 4 + 1] = y;
            positions[v * 4 + 2] = z;
            positions[v * 4 + 3] = 0.0;

            const q_len = Math.sqrt(rot_0 * rot_0 + rot_1 * rot_1 + rot_2 * rot_2 + rot_3 * rot_3);
            const q0 = rot_0 / q_len;
            const q1 = rot_1 / q_len;
            const q2 = rot_2 / q_len;
            const q3 = rot_3 / q_len;

            // construct rotation from quaternion
            const r00 = 1 - 2 * (q2 * q2 + q3 * q3);
            const r01 = 2 * (q1 * q2 - q0 * q3);
            const r02 = 2 * (q1 * q3 + q0 * q2);

            const r10 = 2 * (q1 * q2 + q0 * q3);
            const r11 = 1 - 2 * (q1 * q1 + q3 * q3);
            const r12 = 2 * (q2 * q3 - q0 * q1);

            const r20 = 2 * (q1 * q3 - q0 * q2);
            const r21 = 2 * (q2 * q3 + q0 * q1);
            const r22 = 1 - 2 * (q1 * q1 + q2 * q2);

            const s0 = scale_0;
            const s1 = scale_1;
            const s2 = scale_2;

            // compute T = R * S
            const t00 = r00 * s0;
            const t01 = r01 * s1;
            const t02 = r02 * s2;
            const t10 = r10 * s0;
            const t11 = r11 * s1;
            const t12 = r12 * s2;
            const t20 = r20 * s0;
            const t21 = r21 * s1;
            const t22 = r22 * s2;

            // compute covariance matrix C = T * T^T
            const c_xx = t00 * t00 + t01 * t01 + t02 * t02;
            const c_xy = t00 * t10 + t01 * t11 + t02 * t12;
            const c_xz = t00 * t20 + t01 * t21 + t02 * t22;
            const c_yy = t10 * t10 + t11 * t11 + t12 * t12;
            const c_yz = t10 * t20 + t11 * t21 + t12 * t22;
            const c_zz = t20 * t20 + t21 * t21 + t22 * t22;

            // write cov3d [c_xx, c_xy, c_xz, c_yy, c_yz, c_zz, 0, 0]
            cov3d[v * 8 + 0] = c_xx;
            cov3d[v * 8 + 1] = c_xy;
            cov3d[v * 8 + 2] = c_xz;
            cov3d[v * 8 + 3] = c_yy;
            cov3d[v * 8 + 4] = c_yz;
            cov3d[v * 8 + 5] = c_zz;
            cov3d[v * 8 + 6] = 0.0;
            cov3d[v * 8 + 7] = 0.0;

            // write colors [r, g, b, opacity] using degree-0 only (fallback / backward compat)
            colors[v * 4 + 0] = 0.5 + SH_C0 * f_dc_0;
            colors[v * 4 + 1] = 0.5 + SH_C0 * f_dc_1;
            colors[v * 4 + 2] = 0.5 + SH_C0 * f_dc_2;
            colors[v * 4 + 3] = opacity;

            // Store 15 higher-order basis coefficients as tight [R, G, B] triples.
            for (let b = 0; b < Math.min(perChannel, 15); b++) {
                const r  = dataView.getFloat32(baseOffset + fRestOffsets[b], true);
                const g  = dataView.getFloat32(baseOffset + fRestOffsets[b + perChannel], true);
                const bl = dataView.getFloat32(baseOffset + fRestOffsets[b + 2 * perChannel], true);
                shCoeffs[v * 45 + b * 3 + 0] = r;
                shCoeffs[v * 45 + b * 3 + 1] = g;
                shCoeffs[v * 45 + b * 3 + 2] = bl;
            }
        }

        return {
            positions,
            cov3d,
            colors,
            shCoeffs,
            maxSHDegree,
            count: this.numVertices
        };
    }

    private parseASCII(buffer: ArrayBuffer): GaussianBuffers {
        const decoder = new TextDecoder();
        const headerEndIndex = this.headerLength - 11;
        const text = decoder.decode(buffer.slice(headerEndIndex + 11));
        const lines = text.trim().split('\n');

        const SH_C0 = 0.28209479177387814;

        const positions = new Float32Array(this.numVertices * 4);
        const cov3d = new Float32Array(this.numVertices * 8);
        const colors = new Float32Array(this.numVertices * 4);

        const fRestCount = this.properties.filter(p => p.name.startsWith('f_rest_')).length;
        const perChannel = Math.floor(fRestCount / 3);
        let maxSHDegree = 0;
        if (perChannel >= 3) maxSHDegree = 1;
        if (perChannel >= 8) maxSHDegree = 2;
        if (perChannel >= 15) maxSHDegree = 3;
        const fRestBaseIdx = this.properties.findIndex(p => p.name === 'f_rest_0');
        const shCoeffs = new Float32Array(this.numVertices * 45);

        for (let v = 0; v < this.numVertices && v < lines.length; v++) {
            const tokens = lines[v].split(/\s+/).filter(t => t.length > 0);
            if (tokens.length < this.properties.length) continue;

            const values: number[] = tokens.map(t => parseFloat(t));

            const x = values[0];
            const y = values[1];
            const z = values[2];

            const rot_0 = values[3];
            const rot_1 = values[4];
            const rot_2 = values[5];
            const rot_3 = values[6];

            const scale_0 = Math.exp(values[7]);
            const scale_1 = Math.exp(values[8]);
            const scale_2 = Math.exp(values[9]);

            const f_dc_0 = values[10];
            const f_dc_1 = values[11];
            const f_dc_2 = values[12];

            const opacity = 1.0 / (1.0 + Math.exp(-values[13]));

            // write positions
            positions[v * 4 + 0] = x;
            positions[v * 4 + 1] = y;
            positions[v * 4 + 2] = z;
            positions[v * 4 + 3] = 0.0;

            // compute covariance matrix from rot and scale
            const q_len = Math.sqrt(rot_0 * rot_0 + rot_1 * rot_1 + rot_2 * rot_2 + rot_3 * rot_3);
            const q0 = rot_0 / q_len;
            const q1 = rot_1 / q_len;
            const q2 = rot_2 / q_len;
            const q3 = rot_3 / q_len;

            const r00 = 1 - 2 * (q2 * q2 + q3 * q3);
            const r01 = 2 * (q1 * q2 - q0 * q3);
            const r02 = 2 * (q1 * q3 + q0 * q2);

            const r10 = 2 * (q1 * q2 + q0 * q3);
            const r11 = 1 - 2 * (q1 * q1 + q3 * q3);
            const r12 = 2 * (q2 * q3 - q0 * q1);

            const r20 = 2 * (q1 * q3 - q0 * q2);
            const r21 = 2 * (q2 * q3 + q0 * q1);
            const r22 = 1 - 2 * (q1 * q1 + q2 * q2);

            const s0 = scale_0;
            const s1 = scale_1;
            const s2 = scale_2;

            const t00 = r00 * s0;
            const t01 = r01 * s1;
            const t02 = r02 * s2;
            const t10 = r10 * s0;
            const t11 = r11 * s1;
            const t12 = r12 * s2;
            const t20 = r20 * s0;
            const t21 = r21 * s1;
            const t22 = r22 * s2;

            const c_xx = t00 * t00 + t01 * t01 + t02 * t02;
            const c_xy = t00 * t10 + t01 * t11 + t02 * t12;
            const c_xz = t00 * t20 + t01 * t21 + t02 * t22;
            const c_yy = t10 * t10 + t11 * t11 + t12 * t12;
            const c_yz = t10 * t20 + t11 * t21 + t12 * t22;
            const c_zz = t20 * t20 + t21 * t21 + t22 * t22;

            // write cov3d
            cov3d[v * 8 + 0] = c_xx;
            cov3d[v * 8 + 1] = c_xy;
            cov3d[v * 8 + 2] = c_xz;
            cov3d[v * 8 + 3] = c_yy;
            cov3d[v * 8 + 4] = c_yz;
            cov3d[v * 8 + 5] = c_zz;
            cov3d[v * 8 + 6] = 0.0;
            cov3d[v * 8 + 7] = 0.0;

            // write colors
            colors[v * 4 + 0] = 0.5 + SH_C0 * f_dc_0;
            colors[v * 4 + 1] = 0.5 + SH_C0 * f_dc_1;
            colors[v * 4 + 2] = 0.5 + SH_C0 * f_dc_2;
            colors[v * 4 + 3] = opacity;

            // rest sh coeffs
            if (fRestBaseIdx >= 0) {
                for (let b = 0; b < Math.min(perChannel, 15); b++) {
                    const r  = values[fRestBaseIdx + b] ?? 0;
                    const g  = values[fRestBaseIdx + b + perChannel] ?? 0;
                    const bl = values[fRestBaseIdx + b + 2 * perChannel] ?? 0;
                    shCoeffs[v * 45 + b * 3 + 0] = r;
                    shCoeffs[v * 45 + b * 3 + 1] = g;
                    shCoeffs[v * 45 + b * 3 + 2] = bl;
                }
            }
        }

        return {
            positions,
            cov3d,
            colors,
            shCoeffs,
            maxSHDegree,
            count: this.numVertices
        };
    }

    private getTypeSize(type: string): number {
        switch (type.toLowerCase()) {
            case 'char':
            case 'int8':
            case 'uchar':
            case 'uint8':
                return 1;
            case 'short':
            case 'int16':
            case 'ushort':
            case 'uint16':
                return 2;
            case 'int':
            case 'int32':
            case 'uint':
            case 'uint32':
            case 'float':
            case 'float32':
                return 4;
            case 'int64':
            case 'uint64':
            case 'float64':
            case 'double':
                return 8;
            default:
                throw new Error(`Unknown type size for: ${type}`);
        }
    }
}
