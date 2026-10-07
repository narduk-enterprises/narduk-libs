#if canImport(Metal)
    /// Jellyfish: a translucent moon jelly swimming in the deep. The bell is a real 3-D volume, marched through, so it
    /// glows like glass: thin and clear at the crown, bright where the eye looks along the shell at its rim, with
    /// sixteen radial canals, a ring canal, four pink horseshoe gonads and bioluminescent lights around a scalloped
    /// margin. Long trailing tentacles and four frilled oral arms hang below it in 3-D (front ones pass in front of
    /// the bell, back ones are seen through it), with depth blur. God rays fall from the surface and marine snow
    /// drifts through two depths.
    ///
    /// The music swims it: every two beats the bell contracts (crown first, the margin a moment later) and the jelly
    /// lifts, and the stroke travels down the tentacles as a wave. A kick snaps an extra stroke; bass swells the bell
    /// and its glow; each canal is one spectrum band, so an equaliser runs around the bell; hats and highs spark the
    /// rim lights and the snow; a snare ripples the margin; the drop deepens the glow. The palette tints the shell
    /// (c2), the gonads and arms (c1) and the tentacles and water (c0). Calm slows it and softens the strokes.
    enum JellyfishShader {
        static let source = #"""
            struct JellyCamera {
                float3 ro;
                float3 fw;
                float3 rt;
                float3 up;
                float fl;
            };

            // Screen position (same units as the pixel's p) of world point `w`, and its depth in z.
            static float3 jellyProject(thread const JellyCamera &cam, float3 w) {
                float3 d = w - cam.ro;
                float z = max(dot(d, cam.fw), 0.05);
                return float3(float2(dot(d, cam.rt), dot(d, cam.up)) * cam.fl / z, z);
            }

            // One swim stroke over a 0...1 cycle: a quick contraction, then a long relaxation.
            static float jellyStroke(float t) {
                t = fract(t);
                return smoothstep(0.0, 0.12, t) * exp(-max(t - 0.12, 0.0) * 5.0);
            }

            static float2 jellyRotate(float2 v, float a) {
                float c = cos(a);
                float s = sin(a);
                return float2(c * v.x - s * v.y, s * v.x + c * v.y);
            }

            struct JellyBody {
                float3 center;
                float tilt;      // lean about the view axis
                float spin;      // slow turn about its own vertical axis
                float a;         // bell radius
                float b;         // bell height above the equator
                float swim;      // the stroke clock (cycles)
                float strength;  // how hard a stroke contracts
                float kick;
                float snare;
                float time;
            };

            // World point -> the bell's own frame (y up through the crown, origin at the bell's equator centre).
            static float3 jellyLocal(thread const JellyBody &j, float3 w) {
                float3 q = w - j.center;
                q.xy = jellyRotate(q.xy, -j.tilt);
                q.xz = jellyRotate(q.xz, -j.spin);
                return q;
            }

            static float3 jellyWorld(thread const JellyBody &j, float3 q) {
                q.xz = jellyRotate(q.xz, j.spin);
                q.xy = jellyRotate(q.xy, j.tilt);
                return q + j.center;
            }

            // The contraction at normalised height yn (1 crown, 0 margin): the crown leads, the margin follows.
            static float jellyContraction(thread const JellyBody &j, float yn) {
                float stroke = jellyStroke(j.swim - (1.0 - yn) * 0.1) * j.strength;
                return saturate(max(stroke, 0.8 * j.kick));
            }

            // The margin's height and radius at angle phi (bell frame).
            static float2 jellyRim(thread const JellyBody &j, float phi) {
                float c = jellyContraction(j, 0.0);
                float scallop = 0.018 * cos(phi * 16.0);
                float ripple = 0.035 * j.snare * sin(phi * 6.0 - j.time * 9.0);
                float rimY = -0.22 * j.b + scallop + ripple + 0.06 * j.b * c;
                float a = j.a * (1.0 - 0.24 * c);
                float b = j.b * (1.0 + 0.12 * c);
                float r = a * sqrt(max(1.0 - (rimY * rimY) / (b * b), 0.0)) * 0.97;
                return float2(rimY, r);
            }

            fragment float4 jellyfishFragment(
                IntenseVertexOut in [[stage_in]], constant IntenseUniforms &u [[buffer(0)]],
                constant float *spectrum [[buffer(1)]], constant float *wave [[buffer(2)]]) {
                float aspect = u.resTime.x / u.resTime.y;
                float intensity = u.extra.z;
                float time = u.resTime.z * mix(0.45, 1.0, intensity);
                float beats = u.resTime.w;
                float kick = u.env.x * intensity;
                float snare = u.env.y * intensity;
                float hat = u.env.z * intensity;
                float energy = u.wobble.z;
                float drop = u.misc.y;
                float bass = bandAt(spectrum, 0.05);
                float highs = bandAt(spectrum, 0.8);

                float2 p = (in.uv - 0.5) * float2(aspect, 1.0) * 2.0;
                float2 sp = float2(p.x, -p.y);  // y up

                float3 shellTint = mix(u.c2.rgb, float3(0.85, 0.95, 1.0), 0.55);
                float3 gonadTint = mix(u.c1.rgb, float3(1.0, 0.75, 0.9), 0.25);
                float3 tentTint = mix(mix(u.c0.rgb, u.c2.rgb, 0.5), float3(0.9, 0.9, 1.0), 0.35);
                float3 water = u.c0.rgb * 0.025 + float3(0.002, 0.008, 0.032);

                JellyCamera cam;
                cam.ro = float3(0.0, -0.5, 3.0);
                float3 target = float3(0.0, -0.05, 0.0);
                cam.fw = normalize(target - cam.ro);
                cam.rt = normalize(cross(cam.fw, float3(0.0, 1.0, 0.0)));
                cam.up = cross(cam.rt, cam.fw);
                cam.fl = 2.3;

                JellyBody j;
                j.time = time;
                j.swim = beats * 0.5 + time * 0.04;
                j.strength = (0.45 + 0.35 * energy + 0.3 * bass) * intensity;
                j.kick = kick;
                j.snare = snare;
                float liftStroke = jellyStroke(j.swim - 0.05) * j.strength;
                j.center = float3(
                    0.22 * sin(time * 0.11) + 0.08 * sin(time * 0.27 + 1.3),
                    0.42 + 0.07 * sin(time * 0.19) + 0.06 * liftStroke + 0.03 * kick,
                    0.15 * sin(time * 0.09 + 2.0));
                j.tilt = 0.14 * sin(time * 0.15 + 0.4) - 0.1 * (j.center.x);
                j.spin = time * 0.06;
                j.a = 0.56 * (1.0 + 0.1 * bass + 0.04 * drop);
                j.b = 0.42;
                float glow = 0.75 + 0.5 * bass + 0.35 * drop + 0.15 * energy;

                // ---- The water: depth gradient, god rays from the surface, marine snow -----------------------------
                float depth = saturate(0.5 - 0.5 * sp.y);
                float3 back = mix(water * 2.4 + u.c2.rgb * 0.02, water * 0.5, depth);
                float shafts = fbm(float2(sp.x * 2.2 + sp.y * 0.55 + time * 0.03, time * 0.05));
                shafts = pow(saturate(shafts * 1.5 - 0.35), 2.5) * smoothstep(-1.1, 1.0, sp.y);
                back += mix(u.c2.rgb, float3(0.7, 0.9, 1.0), 0.6) * shafts * (0.12 + 0.05 * bass);
                back += mix(u.c2.rgb, float3(1.0), 0.6) * exp(-(1.0 - sp.y) * 2.6) * 0.06;
                for (int layer = 0; layer < 2; layer++) {
                    float fl = float(layer);
                    float cs = layer == 0 ? 0.075 : 0.16;
                    float2 drift = float2(time * (0.008 + 0.01 * fl), time * (0.015 + 0.02 * fl));
                    float2 c;
                    float h;
                    float2 q = sp + drift + fl * 3.7;
                    if (fxCell(q, cs, 31.0 + fl * 7.0, layer == 0 ? 0.35 : 0.22, c, h)) {
                        float size = (layer == 0 ? 0.0035 : 0.009) * (0.5 + h);
                        float d = length(q - c);
                        float mote = exp(-d * d / (size * size));
                        if (layer == 1) mote *= 0.35;  // near motes are out of focus: big and faint
                        float tw = 0.6 + 0.4 * sin(time * (1.0 + 2.0 * h) + h * 30.0) + 0.6 * hat + 0.4 * highs;
                        back += mix(tentTint, float3(1.0), 0.5) * mote * tw * 0.35;
                    }
                }

                // ---- Tentacles and oral arms, in 3-D, split into behind and in front of the bell -----------------
                float3 behind = float3(0.0);
                float3 front = float3(0.0);
                float3 centerScreen = jellyProject(cam, j.center);
                const int tentacles = 14;
                for (int i = 0; i < tentacles + 4; i++) {
                    bool arm = i >= tentacles;
                    float fi = float(i);
                    float hi = hash11(fi * 3.17 + 1.0);
                    float phi = arm ? (float(i - tentacles) + 0.5) * 1.5707963 + 0.3 : (fi + 0.3 * hi) / float(tentacles) * 6.2831853;
                    float2 rim = jellyRim(j, phi);
                    float anchorR = arm ? 0.07 : rim.y;
                    float anchorY = arm ? rim.x + 0.1 : rim.x;
                    float L = arm ? 0.85 + 0.15 * hi : 1.25 + 0.55 * hi;
                    float3 anchor = jellyWorld(j, float3(anchorR * cos(phi), anchorY, anchorR * sin(phi)));
                    float3 pa = jellyProject(cam, anchor);
                    float scale = cam.fl / pa.z;
                    float s = (pa.y - sp.y) / (scale * L);
                    if (s < -0.02 || s > 1.0) continue;
                    s = max(s, 0.0);
                    float2 radial = float2(cos(phi + j.spin), sin(phi + j.spin));
                    // Two nearby samples along the strand give its screen slope, so the width stays even on curves.
                    float3 pts[2];
                    for (int k = 0; k < 2; k++) {
                        float sk = s + float(k) * 0.02;
                        float wave = jellyStroke(j.swim - 0.12 - sk * 0.5) * j.strength;
                        float amp = arm ? 0.05 + 0.12 * sk : 0.04 + 0.2 * sk * sk;
                        float speed = arm ? 0.9 : 1.5;
                        float dx = amp * sin(5.0 * sk - time * speed + fi * 1.7) + 0.05 * sin(13.0 * sk - time * 2.3 + fi);
                        float dz = amp * cos(4.1 * sk - time * speed * 0.8 + fi * 2.3);
                        float flare = arm ? 0.05 * sk * wave : (0.16 * wave - 0.05) * sk;
                        float3 w = anchor + float3(
                            dx + radial.x * flare, -sk * L * (1.0 - 0.1 * wave), dz + radial.y * flare);
                        pts[k] = jellyProject(cam, w);
                    }
                    float slope = (pts[1].x - pts[0].x) / max(abs(pts[1].y - pts[0].y), 1e-4);
                    float dist = abs(sp.x - pts[0].x) / sqrt(1.0 + slope * slope);
                    float near = cam.fl / pts[0].z;
                    float blur = abs(pts[0].z - centerScreen.z) * 0.006;
                    float3 contribution;
                    if (arm) {
                        // Oral arm: a translucent frilled ribbon, bright ruffled edges over soft folds.
                        float w = (0.09 * (1.0 - 0.55 * s) * (1.0 + 0.35 * sin(s * 31.0 + time * 1.7 + fi))) * near * 0.45 + blur;
                        float edge = exp(-pow((dist - w) / (0.3 * w + 0.002), 2.0));
                        float inside = smoothstep(w, w * 0.6, dist);
                        float folds = 0.55 + 0.45 * sin(s * 70.0 - time * 1.2 + dist / max(w, 1e-4) * 5.0);
                        float fade = smoothstep(1.0, 0.65, s);
                        contribution = gonadTint * (edge * 0.55 + inside * folds * 0.14) * fade * glow;
                    } else {
                        // Tentacle: a fine glowing filament with stinging-cell beads, fading toward the tip.
                        float w = (0.0028 + 0.0028 * (1.0 - s)) * near * 0.45 + blur;
                        float line = exp(-dist * dist / (w * w));
                        float beads = 0.65 + 0.35 * sin(s * 95.0 - time * 3.0 + fi * 4.0);
                        float fade = pow(1.0 - s, 0.8) * smoothstep(-0.02, 0.03, s);
                        float focus = 1.0 / (1.0 + blur * 120.0);
                        contribution = tentTint * line * beads * fade * (0.5 + 0.5 * focus) * 0.8 * glow;
                    }
                    if (pts[0].z < centerScreen.z) front += contribution; else behind += contribution;
                }

                // ---- The bell: march through its glassy volume -------------------------------------------------
                float3 rd = normalize(cam.fw * cam.fl + cam.rt * sp.x + cam.up * sp.y);
                float3 oc = cam.ro - j.center;
                float bound = j.a * 1.35;
                float bb = dot(oc, rd);
                float cc = dot(oc, oc) - bound * bound;
                float disc = bb * bb - cc;
                float3 bell = float3(0.0);
                float transmit = 1.0;
                if (disc > 0.0) {
                    float sq = sqrt(disc);
                    float t0 = max(-bb - sq, 0.0);
                    float t1 = -bb + sq;
                    const int steps = 60;
                    float dt = (t1 - t0) / float(steps);
                    float jitter = hash21(in.uv * u.resTime.xy) * dt * 0.5;
                    float3 rdLocal = rd;
                    rdLocal.xy = jellyRotate(rdLocal.xy, -j.tilt);
                    rdLocal.xz = jellyRotate(rdLocal.xz, -j.spin);
                    for (int i = 0; i < steps; i++) {
                        float3 w = cam.ro + rd * (t0 + jitter + dt * float(i));
                        float3 q = jellyLocal(j, w);
                        float phi = atan2(q.z, q.x);
                        float yn = saturate((q.y + 0.25 * j.b) / (1.25 * j.b));
                        float c = jellyContraction(j, yn);
                        float a = j.a * (1.0 - 0.24 * c * (1.0 - 0.4 * yn)) * (1.0 + 0.025 * sin(phi * 3.0 + time * 0.7));
                        float b = j.b * (1.0 + 0.12 * c);
                        float k = length(q / float3(a, b, a));
                        float d = (k - 1.0) * min(a, b);
                        float thick = mix(0.012, 0.05, yn);
                        float2 rim = jellyRim(j, phi);
                        float below = rim.x - q.y;
                        float shell = max(abs(d + thick) - thick, below);
                        float density = exp(-max(shell, 0.0) * 90.0);
                        // Radial canals (one spectrum band each) and the ring canal along the margin.
                        float canalIndex = floor(phi / 6.2831853 * 16.0 + 16.5);
                        float band = bandAt(spectrum, fract(canalIndex / 16.0) * 0.85 + 0.05);
                        float rr = length(q.xz);
                        float canalGap = abs(sin(phi * 8.0)) * rr / 8.0;  // distance to the nearest canal, world units
                        float canal = exp(-pow(canalGap / 0.0045, 2.0)) * smoothstep(0.04, 0.16, rr) * (0.4 + 2.2 * band);
                        // A canal seen edge-on (the ray inside its meridian plane) would read as a hard line: dim it.
                        float edgeOn = abs(dot(rdLocal, float3(-sin(phi), 0.0, cos(phi))));
                        canal *= saturate(0.15 + 4.0 * edgeOn);
                        float ring = exp(-pow((q.y - rim.x - 0.015) / 0.012, 2.0)) * 1.4;
                        // The canals live in the tissue only: a canal plane seen edge-on must not glow through the open water.
                        float tissue = exp(-max(shell, 0.0) * 600.0);
                        float3 emit = shellTint * (density * (0.18 + 0.3 * yn) + tissue * (canal * 1.6 + ring));
                        // Four horseshoe gonads on the underside of the crown.
                        float gq = phi - 0.7853982;
                        float sector = gq - 1.5707963 * floor(gq / 1.5707963 + 0.5);
                        float2 local = float2(rr * cos(sector) - 0.28 * a, rr * sin(sector));
                        float horse = abs(length(local) - 0.12 * a);
                        float open = smoothstep(-0.02, 0.05, -local.x + 0.05 * a);
                        float gy = 0.42 * b;
                        float gonad = exp(-pow(horse / 0.022, 2.0)) * exp(-pow((q.y - gy) / 0.035, 2.0)) * open;
                        emit += gonadTint * gonad * (3.0 + 1.5 * c);
                        // Bioluminescent lights around the margin, one per scallop; hats and highs spark them.
                        float lightPhi = (floor(phi / 6.2831853 * 16.0) + 0.5) / 16.0 * 6.2831853;
                        float3 lp = float3(rim.y * cos(lightPhi), rim.x, rim.y * sin(lightPhi));
                        float sparkle = 0.6 + 1.6 * hat + 0.8 * highs + 0.6 * drop;
                        emit += mix(shellTint, float3(1.0), 0.5) * exp(-dot(q - lp, q - lp) / 0.00012) * sparkle;
                        bell += emit * transmit * dt * 6.0 * glow;
                        transmit *= exp(-density * dt * 1.5);
                    }
                }

                // A soft glow in the water around the bell.
                float2 halo = (sp - centerScreen.xy) / float2(1.0, 0.75);
                back += shellTint * exp(-length(halo) / 0.32) * 0.07 * glow;
                float3 col = (back + behind) * transmit + bell + front;
                col = fxFlash(col, u, 0.25);
                col = fxTonemap(col, 1.25);
                col = fxVignette(col, p, 0.12);
                return float4(clamp(col, 0.0, 1.0), 1.0);
            }
            """#
    }
#endif
