"use strict";
var Photography = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // src/global.ts
  var global_exports = {};
  __export(global_exports, {
    Camera: () => Camera,
    DEVELOP_SCHEMA: () => DEVELOP_SCHEMA,
    Darkroom: () => Darkroom,
    EXPOSURE_SCHEMA: () => EXPOSURE_SCHEMA,
    SCHEMA: () => SCHEMA,
    defaultParams: () => defaultParams,
    formatParam: () => formatParam,
    inertReason: () => inertReason
  });

  // node_modules/@amplib/devices/dist/index.js
  var CameraStream = class {
    stream = null;
    devices = [];
    /** A short human-readable name for the active track. */
    label = "";
    facingMode;
    width;
    height;
    deviceIndex = 0;
    constructor({
      facingMode = "environment",
      width = 1280,
      height = 720
    } = {}) {
      this.facingMode = facingMode;
      this.width = width;
      this.height = height;
    }
    /** Whether cycling would reach a different camera. */
    get canCycle() {
      return this.devices.length > 1;
    }
    /**
     * Start the camera. Pass a deviceId to open a specific one, otherwise the
     * preferred facing mode decides.
     */
    async start(deviceId) {
      this.stop();
      const constraints = deviceId ? { video: { deviceId: { exact: deviceId } }, audio: false } : {
        video: {
          facingMode: this.facingMode,
          width: { ideal: this.width },
          height: { ideal: this.height }
        },
        audio: false
      };
      this.stream = await navigator.mediaDevices.getUserMedia(constraints);
      this.label = this.readLabel();
      await this.refreshDevices();
      if (deviceId) {
        const index = this.devices.findIndex((d) => d.deviceId === deviceId);
        if (index >= 0) this.deviceIndex = index;
      }
      return this.stream;
    }
    /** Move to the next camera. No-op with fewer than two. */
    async cycle() {
      if (!this.canCycle) return this.stream;
      this.deviceIndex = (this.deviceIndex + 1) % this.devices.length;
      return this.start(this.devices[this.deviceIndex].deviceId);
    }
    async refreshDevices() {
      try {
        const all = await navigator.mediaDevices.enumerateDevices();
        this.devices = all.filter((device) => device.kind === "videoinput");
      } catch {
        this.devices = [];
      }
      return this.devices;
    }
    stop() {
      if (!this.stream) return;
      for (const track of this.stream.getTracks()) track.stop();
      this.stream = null;
    }
    readLabel() {
      var _a;
      const track = (_a = this.stream) == null ? void 0 : _a.getVideoTracks()[0];
      return ((track == null ? void 0 : track.label) || "camera").slice(0, 28);
    }
  };

  // src/Camera.ts
  var Camera = class {
    video;
    /** The frame rate in force, read back from the track rather than requested. */
    fps = 30;
    source;
    facingMode;
    width;
    height;
    requestedFrameRate;
    followOrientation;
    orientationTimer = null;
    listening = false;
    onOrientation = () => this.handleOrientation();
    constructor({
      facingMode = "environment",
      width = 1920,
      height = 1080,
      frameRate,
      followOrientation = true,
      video
    } = {}) {
      this.facingMode = facingMode;
      this.width = width;
      this.height = height;
      this.requestedFrameRate = frameRate;
      this.followOrientation = followOrientation;
      this.source = this.makeStream();
      this.video = video ?? document.createElement("video");
      this.video.playsInline = true;
      this.video.muted = true;
      this.video.autoplay = true;
    }
    /** The underlying @amplib/devices stream, for device enumeration and the like. */
    get stream() {
      return this.source;
    }
    /** True when the preview and the capture should both be flipped. */
    get mirrored() {
      return this.facingMode === "user";
    }
    get size() {
      return { width: this.video.videoWidth, height: this.video.videoHeight };
    }
    get running() {
      return !!this.source.stream;
    }
    /** Whether cycling would reach a different camera. */
    get canCycle() {
      return this.source.canCycle;
    }
    /** How long a burst of `frames` holds the shutter open, in milliseconds. */
    shutterMs(frames) {
      return Math.round(frames * 1e3 / Math.max(this.fps, 1));
    }
    async start() {
      await this.attach(await this.source.start());
      if (this.followOrientation) this.listen();
    }
    /** Move to the next camera the device reports. */
    async cycle() {
      const next = await this.source.cycle();
      if (next) await this.attach(next);
    }
    /**
     * Swap between front and back. Distinct from `cycle`, which walks every
     * camera reported — on a phone with three rear lenses those are not the same
     * journey.
     */
    async flip() {
      this.facingMode = this.facingMode === "user" ? "environment" : "user";
      this.source.stop();
      this.source = this.makeStream();
      await this.attach(await this.source.start());
    }
    stop() {
      this.source.stop();
      if (this.orientationTimer) clearTimeout(this.orientationTimer);
      this.orientationTimer = null;
      if (this.listening) {
        window.removeEventListener("orientationchange", this.onOrientation);
        window.removeEventListener("resize", this.onOrientation);
        screen.orientation?.removeEventListener?.("change", this.onOrientation);
        this.listening = false;
      }
    }
    makeStream() {
      return new CameraStream({
        facingMode: this.facingMode,
        width: this.width,
        height: this.height
      });
    }
    /**
     * Ask the running camera for a different frame rate, or pass nothing to drop
     * the cap. Applied to the live track rather than by re-acquiring, so the
     * preview does not blink; `fps` afterwards is what was granted, which on
     * Safari is often not what was asked for.
     */
    async setFrameRate(frameRate) {
      this.requestedFrameRate = frameRate;
      const track = this.video.srcObject?.getVideoTracks()[0];
      if (!track) return this.fps;
      try {
        await track.applyConstraints(
          frameRate ? { frameRate: { ideal: frameRate, max: frameRate } } : {}
        );
      } catch {
      }
      this.fps = track.getSettings().frameRate ?? frameRate ?? 30;
      return this.fps;
    }
    async attach(media) {
      this.video.srcObject = media;
      await this.video.play();
      await this.setFrameRate(this.requestedFrameRate);
    }
    listen() {
      if (this.listening) return;
      this.listening = true;
      window.addEventListener("orientationchange", this.onOrientation);
      window.addEventListener("resize", this.onOrientation);
      screen.orientation?.addEventListener?.("change", this.onOrientation);
    }
    /**
     * Uploading the video element captures exactly the frame the preview shows,
     * so the two can never disagree about rotation — what breaks on a device turn
     * is a platform that keeps handing out landscape frames while the device is
     * portrait. That is visible in the preview too, so it is renegotiated rather
     * than rotated after the fact: the rotation direction cannot be derived
     * reliably, and a wrong guess is worse than a restart.
     */
    handleOrientation() {
      if (this.orientationTimer) clearTimeout(this.orientationTimer);
      this.orientationTimer = setTimeout(() => {
        if (!this.running || !this.video.videoWidth) return;
        const streamLandscape = this.video.videoWidth > this.video.videoHeight;
        const screenLandscape = window.innerWidth > window.innerHeight;
        if (streamLandscape !== screenLandscape) {
          this.source.start().then((media) => this.attach(media)).catch(() => {
          });
        }
      }, 350);
    }
  };

  // src/shaders.ts
  var VERT = `#version 300 es
out vec2 vUv;
void main() {
  vec2 p = vec2(gl_VertexID == 1 ? 3.0 : -1.0, gl_VertexID == 2 ? 3.0 : -1.0);
  vUv = p * 0.5 + 0.5;
  gl_Position = vec4(p, 0.0, 1.0);
}`;
  var HEAD = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
`;
  var FRAG_ACCUMULATE = `#version 300 es
precision highp float;
in vec2 vUv;
layout(location = 0) out vec4 outS0;
layout(location = 1) out vec4 outS1;
uniform sampler2D uFrame;
uniform float uW;
uniform float uRampW;
uniform float uMirror;
void main() {
  vec2 uv = vec2(uMirror > 0.5 ? 1.0 - vUv.x : vUv.x, vUv.y);
  vec3 rgb = texture(uFrame, uv).rgb;
  outS0 = vec4(rgb * uW, uW);
  outS1 = vec4(rgb * uRampW, uRampW);
}`;
  var FRAG_RESOLVE = `${HEAD}
uniform sampler2D uS0;
uniform sampler2D uS1;
uniform float uA;
uniform float uB;
void main() {
  vec4 s0 = texture(uS0, vUv);
  vec4 s1 = texture(uS1, vUv);
  vec3 sum = s0.rgb * uA + s1.rgb * uB;
  float w = s0.a * uA + s1.a * uB;
  outColor = vec4(sum / max(w, 1e-5), 1.0);
}`;
  var FRAG_BLUR = `${HEAD}
uniform sampler2D uSrc;
uniform vec2 uDir;
void main() {
  vec3 s  = texture(uSrc, vUv).rgb * 0.2270270270;
  s += texture(uSrc, vUv + uDir * 1.3846153846).rgb * 0.3162162162;
  s += texture(uSrc, vUv - uDir * 1.3846153846).rgb * 0.3162162162;
  s += texture(uSrc, vUv + uDir * 3.2307692308).rgb * 0.0702702703;
  s += texture(uSrc, vUv - uDir * 3.2307692308).rgb * 0.0702702703;
  outColor = vec4(s, 1.0);
}`;
  var FRAG_BRIGHT = `${HEAD}
uniform sampler2D uSrc;
uniform float uHeadroom;
void main() {
  vec3 c = texture(uSrc, vUv).rgb;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c *= 1.0 + smoothstep(0.80, 1.0, l) * uHeadroom * 6.0;
  float k = max(0.0, l - 0.62) / 0.38;
  outColor = vec4(c * k * k, 1.0);
}`;
  var FRAG_COMPOSITE = `${HEAD}
uniform sampler2D uLin;
uniform sampler2D uSoftTex;
uniform sampler2D uBloom;
uniform sampler2D uDefocus;
uniform vec2 uRes;
uniform float uExposure, uRolloff, uHalation, uHalationHue, uBlack;
uniform float uSoftness, uGrain, uDrift, uSeed;
uniform float uSplit, uShadowHue, uHighlightHue, uVignette;
uniform float uAperture, uFocalPlane;

vec3 fetch(vec2 uv) { return texture(uLin, clamp(uv, 0.001, 0.999)).rgb; }
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

vec3 hue(float h) {
  h = fract(h / 360.0);
  vec3 p = abs(fract(h + vec3(1.0, 2.0, 3.0) / 3.0) * 6.0 - 3.0);
  return clamp(p - 1.0, 0.0, 1.0);
}

float hash(vec2 p) {
  p = fract(p * vec2(443.897, 441.423));
  p += dot(p, p + 19.19);
  return fract((p.x + p.y) * p.x);
}

void main() {
  // drift: sub-degree rotation, cropped in so the corners stay covered
  vec2 uv = vUv - 0.5;
  float a = uDrift * 0.011;
  float cs = cos(a), sn = sin(a);
  uv = mat2(cs, -sn, sn, cs) * uv;
  uv *= 0.976;
  float r = length(uv) * 2.0;
  vec2 base = uv + 0.5;

  // lateral chromatic aberration, radial, quadratic toward the edge
  vec2 d = uv * r * r * uDrift * 0.004;
  vec3 c = vec3(fetch(base + d).r, fetch(base).g, fetch(base - d).b);

  // de-sharpen, undoing the phone's micro-contrast. The blur is a separable
  // pre-pass; this only decides how far toward it to travel.
  c = mix(c, texture(uSoftTex, clamp(base, 0.001, 0.999)).rgb, uSoftness * 0.78);

  // depth of field, faked: defocus grows with distance from a screen-space
  // focal band \u2014 the tilt-shift lie, since a single camera offers no depth.
  float band = smoothstep(0.12, 0.85, abs(base.y - uFocalPlane) * 2.0) * uAperture;
  c = mix(c, texture(uDefocus, clamp(base, 0.001, 0.999)).rgb, band * 0.9);

  // halation \u2014 light escaping its own edges. The bloom already carries the
  // source colour, so multiplying by the strong warm crushes it to film
  // red-orange, and by the near-neutral keeps the source's own hue with only a
  // slight warm bias.
  vec3 warm = vec3(1.0, 0.42, 0.26), neutral = vec3(1.0, 0.88, 0.80);
  c += texture(uBloom, base).rgb * mix(warm, neutral, uHalationHue) * uHalation * 1.7;

  c *= pow(2.0, uExposure);

  // filmic shoulder: a smooth approach to white rather than a hard clip
  float k = 1.0 + uRolloff * 1.5;
  c = mix(c, (1.0 - exp(-c * k)) / (1.0 - exp(-k)), uRolloff);

  // split tone \u2014 shadows one way, highlights the other, mids left alone
  float l = clamp(luma(c), 0.0, 1.0);
  float sw = pow(1.0 - l, 2.0), hw = pow(l, 2.0);
  c += ((hue(uShadowHue) - 0.5) * sw + (hue(uHighlightHue) - 0.5) * hw) * uSplit * 0.24;

  // black point, after the split tone so it can crush that lift back out
  float bp = uBlack * 0.14;
  c = max(c - bp, 0.0) / max(1.0 - bp, 0.001);

  // grain \u2014 monochromatic, weighted to the midtones. Keyed to the render
  // resolution so a half-res preview shows the same grain size on screen.
  float g = hash(vUv * uRes / 1.45 + uSeed);
  c += (g - 0.5) * uGrain * 0.17 * (1.0 - pow(abs(l * 2.0 - 1.0), 1.4));

  c *= 1.0 - uVignette * 0.55 * pow(clamp(r * 0.72, 0.0, 1.0), 2.2);
  outColor = vec4(max(c, 0.0), 1.0);
}`;

  // src/Darkroom.ts
  function abortError(message) {
    const e = new Error(message);
    e.name = "AbortError";
    return e;
  }
  var Darkroom = class {
    canvas;
    gl;
    /** False when EXT_color_buffer_float is missing; highlights then clip at 1.0. */
    floatTargets;
    programs = {};
    uniforms = /* @__PURE__ */ new Map();
    vao;
    frameTex;
    targets = /* @__PURE__ */ new Map();
    internalFormat;
    texType;
    /** What lets `trail` resolve at develop time — see Accum. */
    accum = null;
    /** The kept burst, oldest first, when the last expose asked for it. */
    negative = [];
    negativeMirror = false;
    /** Exposure resolution — the accumulator's size. */
    w = 0;
    h = 0;
    /** Current develop resolution. */
    rw = 0;
    rh = 0;
    seed = 0;
    current = null;
    lastParams = null;
    lastScale = 1;
    busy = false;
    disposed = false;
    constructor(canvas = document.createElement("canvas")) {
      this.canvas = canvas;
      const gl = canvas.getContext("webgl2", {
        // toBlob and toDataURL read the drawing buffer after the frame it was
        // drawn in, which is only defined with this on.
        preserveDrawingBuffer: true,
        alpha: false,
        antialias: false
      });
      if (!gl) throw new Error("Darkroom: WebGL2 is not available.");
      this.gl = gl;
      this.floatTargets = !!gl.getExtension("EXT_color_buffer_float");
      this.internalFormat = this.floatTargets ? gl.RGBA16F : gl.RGBA8;
      this.texType = this.floatTargets ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE;
      this.vao = gl.createVertexArray();
      gl.bindVertexArray(this.vao);
      this.programs = {
        accumulate: this.compile(FRAG_ACCUMULATE),
        resolve: this.compile(FRAG_RESOLVE),
        blur: this.compile(FRAG_BLUR),
        bright: this.compile(FRAG_BRIGHT),
        composite: this.compile(FRAG_COMPOSITE)
      };
      this.frameTex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.frameTex);
      for (const [k, v] of [
        [gl.TEXTURE_MIN_FILTER, gl.LINEAR],
        [gl.TEXTURE_MAG_FILTER, gl.LINEAR],
        [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE],
        [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]
      ]) {
        gl.texParameteri(gl.TEXTURE_2D, k, v);
      }
    }
    /** The exposure currently held, or null before the first one. */
    get exposure() {
      return this.current;
    }
    // ── exposing ───────────────────────────────────────────────────────────────
    /**
     * Stack frames straight off a playing video.
     *
     * Rejects with an `AbortError` rather than returning a torn image if the
     * source changes size mid-burst (a device turn, which would stitch two
     * orientations together), if the signal aborts, or if the page is hidden —
     * a backgrounded tab stops producing frames, and stacking the same stale one
     * eight times looks like a photograph rather than a failure.
     */
    async expose(video, options) {
      if (this.busy) throw new Error("Darkroom: an exposure is already running.");
      if (!video.videoWidth) throw new Error("Darkroom: the video has no frames yet.");
      this.busy = true;
      const kept = [];
      try {
        const total = Math.max(1, Math.round(options.frames));
        this.freeNegative();
        this.beginAccumulation(video.videoWidth, video.videoHeight, options);
        const track = video.srcObject?.getVideoTracks?.()[0];
        for (let i = 0; i < total; i++) {
          await this.nextFrame(video);
          if (options.signal?.aborted) throw abortError("Exposure aborted.");
          if (video.videoWidth !== this.w || video.videoHeight !== this.h) {
            throw abortError("The camera changed orientation mid-exposure.");
          }
          if (typeof document !== "undefined" && document.hidden) {
            throw abortError("The page was hidden mid-exposure.");
          }
          if (track && track.readyState !== "live") {
            throw abortError("The camera stream ended mid-exposure.");
          }
          this.stackFrame(video, i, total, options, kept);
          options.onProgress?.(i + 1, total);
        }
        this.seed = Math.random() * 1e3;
        return this.endAccumulation(total, options, kept);
      } catch (error) {
        for (const tex of kept) this.gl.deleteTexture(tex);
        throw error;
      } finally {
        this.endBlend();
        this.busy = false;
      }
    }
    /**
     * Stack an array of already-decoded frames. The same accumulation as
     * `expose`, without the wait on a live source — a burst of stills, or frames
     * pulled from a decoded video.
     */
    exposeFrames(frames, options) {
      if (!frames.length) throw new Error("Darkroom: no frames to stack.");
      const size = this.sizeOf(frames[0]);
      const kept = [];
      this.freeNegative();
      this.beginAccumulation(size.width, size.height, options);
      try {
        frames.forEach((frame, i) => {
          this.stackFrame(frame, i, frames.length, options, kept);
          options.onProgress?.(i + 1, frames.length);
        });
        this.seed = Math.random() * 1e3;
        return this.endAccumulation(frames.length, options, kept);
      } catch (error) {
        for (const tex of kept) this.gl.deleteTexture(tex);
        throw error;
      } finally {
        this.endBlend();
      }
    }
    /** Frames of the kept negative, or 0 when the last expose did not keep one. */
    get negativeFrames() {
      return this.negative.length;
    }
    /**
     * Re-stack the held negative with a different frame count or stack mode —
     * the capture-time half of the exposure, revisited without recapturing.
     * Uses the first `frames` of the burst (the shutter closing earlier),
     * clamped to what was kept. The grain seed is kept, so only what was asked
     * to change changes. Requires an expose with `keepNegative: true`.
     */
    restack({ frames, stack } = {}) {
      if (this.disposed) throw new Error("Darkroom: disposed.");
      if (this.busy) throw new Error("Darkroom: an exposure is already running.");
      if (!this.negative.length) {
        throw new Error("Darkroom: no negative held \u2014 expose with keepNegative: true.");
      }
      const mode = stack ?? this.current?.stack ?? "mean";
      const total = Math.min(
        this.negative.length,
        Math.max(1, Math.round(frames ?? this.negative.length))
      );
      const options = { frames: total, stack: mode, mirror: this.negativeMirror };
      this.beginAccumulation(this.w, this.h, options);
      try {
        for (let i = 0; i < total; i++) {
          this.drawAccumulate(this.negative[i], i, total, mode, this.negativeMirror);
        }
      } finally {
        this.endBlend();
      }
      return this.endAccumulation(total, options);
    }
    beginAccumulation(width, height, options) {
      const gl = this.gl;
      if (!this.accum || width !== this.w || height !== this.h) {
        this.w = width;
        this.h = height;
        this.freeAccum();
        this.accum = this.makeAccum(width, height);
        this.rw = this.rh = 0;
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.accum.fb);
      gl.viewport(0, 0, this.w, this.h);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      gl.blendEquation(options.stack === "max" ? gl.MAX : gl.FUNC_ADD);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
    }
    /** Upload a frame — into the kept negative when asked — and accumulate it. */
    stackFrame(frame, index, total, options, kept) {
      const gl = this.gl;
      let tex = this.frameTex;
      if (options.keepNegative) {
        tex = this.newTexture();
        kept.push(tex);
      }
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, frame);
      this.drawAccumulate(tex, index, total, options.stack, options.mirror ?? false);
    }
    /** One already-uploaded frame into the two moments. */
    drawAccumulate(tex, index, total, stack, mirror) {
      const gl = this.gl;
      const prog = this.programs.accumulate;
      const mean = stack !== "max";
      const w = mean ? 1 / total : 1;
      const rampW = mean ? (total > 1 ? index / (total - 1) : 1) / total : 0;
      gl.useProgram(prog);
      this.bindTexture(prog, "uFrame", tex, 0);
      gl.uniform1f(this.loc(prog, "uW"), w);
      gl.uniform1f(this.loc(prog, "uRampW"), rampW);
      gl.uniform1f(this.loc(prog, "uMirror"), mirror ? 1 : 0);
      gl.bindVertexArray(this.vao);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.accum.fb);
      gl.viewport(0, 0, this.accum.w, this.accum.h);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    endAccumulation(frames, options, kept) {
      if (kept && options.keepNegative) {
        this.negative = kept;
        this.negativeMirror = options.mirror ?? false;
      }
      this.current = {
        width: this.w,
        height: this.h,
        frames,
        stack: options.stack
      };
      return this.current;
    }
    endBlend() {
      const gl = this.gl;
      gl.disable(gl.BLEND);
      gl.blendEquation(gl.FUNC_ADD);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
    }
    /**
     * requestVideoFrameCallback is the accurate clock, but a stalled stream never
     * fires it and an unraced await would hang the burst with no way back. Racing
     * it against a couple of frame intervals degrades a stall into duplicated
     * frames, which the checks in `expose` then catch.
     */
    nextFrame(video) {
      return new Promise((resolve) => {
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          resolve();
        };
        const rate = video.srcObject ? video.srcObject.getVideoTracks()[0]?.getSettings().frameRate ?? 30 : 30;
        const timer = setTimeout(finish, Math.max(34, Math.round(2e3 / Math.max(rate, 1))));
        if (typeof video.requestVideoFrameCallback === "function") {
          video.requestVideoFrameCallback(() => {
            clearTimeout(timer);
            finish();
          });
        }
      });
    }
    // ── developing ─────────────────────────────────────────────────────────────
    /**
     * Render the held exposure to the canvas.
     *
     * `scale` below 1 renders the whole chain smaller rather than a cheaper
     * approximation of it — every kernel is a fraction of the image, so a 0.5
     * render is the same photograph at half size. That is what makes it usable
     * as a live preview while a control is being dragged.
     */
    develop(params, scale = 1) {
      if (this.disposed) throw new Error("Darkroom: disposed.");
      if (!this.current) throw new Error("Darkroom: nothing has been exposed yet.");
      const gl = this.gl;
      const rw = Math.max(1, Math.round(this.w * scale));
      const rh = Math.max(1, Math.round(this.h * scale));
      this.allocDevelopTargets(rw, rh);
      this.lastParams = params;
      this.lastScale = scale;
      const lin = this.targets.get("lin");
      const soft1 = this.targets.get("soft1");
      const soft2 = this.targets.get("soft2");
      const bloomA = this.targets.get("bloomA");
      const bloomB = this.targets.get("bloomB");
      const defocusA = this.targets.get("defocusA");
      const defocusB = this.targets.get("defocusB");
      const t = this.current.stack === "mean" ? params.trail : 0;
      const resolve = this.programs.resolve;
      gl.useProgram(resolve);
      this.bindTexture(resolve, "uS0", this.accum.s0, 0);
      this.bindTexture(resolve, "uS1", this.accum.s1, 1);
      gl.uniform1f(this.loc(resolve, "uA"), t >= 0 ? 1 : 1 - 6 * t);
      gl.uniform1f(this.loc(resolve, "uB"), 6 * t);
      this.draw(resolve, lin);
      const blur = this.programs.blur;
      const softRadius = (1 + params.softness * 2.6) / this.w;
      gl.useProgram(blur);
      this.bindTexture(blur, "uSrc", lin.tex, 0);
      gl.uniform2f(this.loc(blur, "uDir"), softRadius, 0);
      this.draw(blur, soft1);
      gl.useProgram(blur);
      this.bindTexture(blur, "uSrc", soft1.tex, 0);
      gl.uniform2f(this.loc(blur, "uDir"), 0, softRadius * this.w / this.h);
      this.draw(blur, soft2);
      const bright = this.programs.bright;
      gl.useProgram(bright);
      this.bindTexture(bright, "uSrc", lin.tex, 0);
      gl.uniform1f(this.loc(bright, "uHeadroom"), params.headroom);
      this.draw(bright, bloomA);
      const qw = Math.max(1, this.w >> 2);
      const qh = Math.max(1, this.h >> 2);
      for (let i = 1; i <= 2; i++) {
        gl.useProgram(blur);
        this.bindTexture(blur, "uSrc", bloomA.tex, 0);
        gl.uniform2f(this.loc(blur, "uDir"), i / qw, 0);
        this.draw(blur, bloomB);
        gl.useProgram(blur);
        this.bindTexture(blur, "uSrc", bloomB.tex, 0);
        gl.uniform2f(this.loc(blur, "uDir"), 0, i / qh);
        this.draw(blur, bloomA);
      }
      if (params.aperture > 0) {
        const steps = [
          [lin, defocusB, 1 / qw, 0],
          [defocusB, defocusA, 0, 1 / qh],
          [defocusA, defocusB, 2 / qw, 0],
          [defocusB, defocusA, 0, 2 / qh]
        ];
        for (const [src, dst, dx, dy] of steps) {
          gl.useProgram(blur);
          this.bindTexture(blur, "uSrc", src.tex, 0);
          gl.uniform2f(this.loc(blur, "uDir"), dx, dy);
          this.draw(blur, dst);
        }
      }
      const comp = this.programs.composite;
      gl.useProgram(comp);
      this.bindTexture(comp, "uLin", lin.tex, 0);
      this.bindTexture(comp, "uSoftTex", soft2.tex, 1);
      this.bindTexture(comp, "uBloom", bloomA.tex, 2);
      this.bindTexture(comp, "uDefocus", defocusA.tex, 3);
      gl.uniform2f(this.loc(comp, "uRes"), rw, rh);
      gl.uniform1f(this.loc(comp, "uSeed"), this.seed);
      for (const [name, value] of [
        ["uExposure", params.exposure],
        ["uRolloff", params.rolloff],
        ["uHalation", params.halation],
        ["uHalationHue", params.halationHue],
        ["uBlack", params.black],
        ["uSoftness", params.softness],
        ["uGrain", params.grain],
        ["uDrift", params.drift],
        ["uSplit", params.split],
        ["uShadowHue", params.shadowHue],
        ["uHighlightHue", params.highlightHue],
        ["uVignette", params.vignette],
        ["uAperture", params.aperture],
        ["uFocalPlane", params.focalPlane]
      ]) {
        gl.uniform1f(this.loc(comp, name), value);
      }
      this.draw(comp, null, rw, rh);
    }
    /**
     * Both encoders re-develop at full resolution first if the last render was a
     * preview — saving the half-size version is never what was meant.
     */
    toDataURL(type = "image/jpeg", quality = 0.94) {
      this.ensureFullResolution();
      return this.canvas.toDataURL(type, quality);
    }
    toBlob(type = "image/jpeg", quality = 0.94) {
      this.ensureFullResolution();
      return new Promise((resolve) => this.canvas.toBlob(resolve, type, quality));
    }
    ensureFullResolution() {
      if (this.lastScale !== 1 && this.lastParams) this.develop(this.lastParams, 1);
    }
    // ── plumbing ───────────────────────────────────────────────────────────────
    allocDevelopTargets(rw, rh) {
      if (rw === this.rw && rh === this.rh) return;
      this.rw = rw;
      this.rh = rh;
      this.canvas.width = rw;
      this.canvas.height = rh;
      const bw = Math.max(1, rw >> 2);
      const bh = Math.max(1, rh >> 2);
      for (const name of ["lin", "soft1", "soft2"]) {
        this.free(name);
        this.targets.set(name, this.makeTarget(name, rw, rh));
      }
      for (const name of ["bloomA", "bloomB", "defocusA", "defocusB"]) {
        this.free(name);
        this.targets.set(name, this.makeTarget(name, bw, bh));
      }
    }
    /** A LINEAR/CLAMP texture with no storage yet. */
    newTexture() {
      const gl = this.gl;
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return tex;
    }
    makeRenderTexture(w, h) {
      const gl = this.gl;
      const tex = this.newTexture();
      gl.texImage2D(gl.TEXTURE_2D, 0, this.internalFormat, w, h, 0, gl.RGBA, this.texType, null);
      return tex;
    }
    makeTarget(name, w, h) {
      const gl = this.gl;
      const tex = this.makeRenderTexture(w, h);
      const fb = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
        throw new Error(`Darkroom: could not allocate the "${name}" target at ${w}x${h}.`);
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return { tex, fb, w, h };
    }
    makeAccum(w, h) {
      const gl = this.gl;
      const s0 = this.makeRenderTexture(w, h);
      const s1 = this.makeRenderTexture(w, h);
      const fb = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, s0, 0);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, s1, 0);
      gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
        throw new Error(`Darkroom: could not allocate the accumulator at ${w}x${h}.`);
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return { fb, s0, s1, w, h };
    }
    freeAccum() {
      if (!this.accum) return;
      this.gl.deleteFramebuffer(this.accum.fb);
      this.gl.deleteTexture(this.accum.s0);
      this.gl.deleteTexture(this.accum.s1);
      this.accum = null;
    }
    freeNegative() {
      for (const tex of this.negative) this.gl.deleteTexture(tex);
      this.negative = [];
    }
    free(name) {
      const t = this.targets.get(name);
      if (!t) return;
      this.gl.deleteFramebuffer(t.fb);
      this.gl.deleteTexture(t.tex);
      this.targets.delete(name);
    }
    draw(prog, target, w, h) {
      const gl = this.gl;
      gl.bindVertexArray(this.vao);
      gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.fb : null);
      gl.viewport(0, 0, target ? target.w : w, target ? target.h : h);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    compile(fragSource) {
      const gl = this.gl;
      const prog = gl.createProgram();
      for (const [type, source] of [
        [gl.VERTEX_SHADER, VERT],
        [gl.FRAGMENT_SHADER, fragSource]
      ]) {
        const shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
          throw new Error(`Darkroom: shader failed to compile.
${gl.getShaderInfoLog(shader)}`);
        }
        gl.attachShader(prog, shader);
        gl.deleteShader(shader);
      }
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
        throw new Error(`Darkroom: program failed to link.
${gl.getProgramInfoLog(prog)}`);
      }
      this.uniforms.set(prog, /* @__PURE__ */ new Map());
      return prog;
    }
    /** getUniformLocation is a string lookup into the driver; cache it. */
    loc(prog, name) {
      const cache = this.uniforms.get(prog);
      if (!cache.has(name)) {
        const found = this.gl.getUniformLocation(prog, name);
        if (found) cache.set(name, found);
        else return null;
      }
      return cache.get(name);
    }
    bindTexture(prog, name, tex, unit) {
      const gl = this.gl;
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.uniform1i(this.loc(prog, name), unit);
    }
    sizeOf(frame) {
      const any = frame;
      const width = any.videoWidth || any.naturalWidth || any.width || 0;
      const height = any.videoHeight || any.naturalHeight || any.height || 0;
      if (!width || !height) throw new Error("Darkroom: could not measure the frame.");
      return { width, height };
    }
    dispose() {
      if (this.disposed) return;
      this.disposed = true;
      const gl = this.gl;
      for (const name of [...this.targets.keys()]) this.free(name);
      this.freeAccum();
      this.freeNegative();
      for (const prog of Object.values(this.programs)) gl.deleteProgram(prog);
      gl.deleteTexture(this.frameTex);
      gl.deleteVertexArray(this.vao);
      this.current = null;
    }
  };

  // src/schema.ts
  var EXPOSURE_SCHEMA = [
    {
      key: "frames",
      label: "Motion",
      min: 1,
      // 32 at the slow 15fps rate is a two-second exposure. The accumulator is
      // indifferent to the count — weights normalize at resolve — so the cap is
      // capture time, not precision.
      max: 32,
      step: 1,
      value: 8,
      unit: "f",
      precision: 0
    }
  ];
  var DEVELOP_SCHEMA = [
    {
      key: "trail",
      label: "Trail",
      min: -1,
      max: 1,
      step: 0.01,
      value: 0.55,
      group: "Motion",
      inert: (s) => s.stack === "max" ? "Light trails keeps the brightest value each pixel reached, so there is no per-frame weight for this to bias." : null
    },
    // ±3 stops, not ±1: a mean stack dims anything that moves — a subject
    // crossing N frames keeps 1/N of its light — and one stop cannot buy that
    // back. The shoulder is what keeps +3 from clipping.
    { key: "exposure", label: "Exposure", min: -3, max: 3, step: 0.01, value: 0, group: "Light" },
    { key: "rolloff", label: "Rolloff", min: 0, max: 1, step: 0.01, value: 0.55, group: "Light" },
    { key: "halation", label: "Halation", min: 0, max: 1, step: 0.01, value: 0.3, group: "Light" },
    {
      key: "headroom",
      label: "Headroom",
      min: 0,
      max: 1,
      step: 0.01,
      value: 0.35,
      group: "Light",
      inert: (s) => s.halation > 0 ? null : "Headroom only feeds the halation bloom, which is off."
    },
    {
      key: "halationHue",
      label: "Bloom hue",
      min: 0,
      max: 1,
      step: 0.01,
      value: 0.5,
      group: "Light",
      inert: (s) => s.halation > 0 ? null : "Tints the halation bloom, which is off."
    },
    { key: "black", label: "Black", min: 0, max: 1, step: 0.01, value: 0.15, group: "Light" },
    { key: "softness", label: "Softness", min: 0, max: 1, step: 0.01, value: 0.38, group: "Texture" },
    { key: "grain", label: "Grain", min: 0, max: 1, step: 0.01, value: 0.35, group: "Texture" },
    { key: "drift", label: "Drift", min: 0, max: 1, step: 0.01, value: 0.3, group: "Texture" },
    { key: "aperture", label: "Aperture", min: 0, max: 1, step: 0.01, value: 0, group: "Focus" },
    {
      key: "focalPlane",
      label: "Plane",
      min: 0,
      max: 1,
      step: 0.01,
      value: 0.5,
      group: "Focus",
      inert: (s) => s.aperture > 0 ? null : "Positions the sharp band, and the aperture is closed \u2014 nothing is defocused."
    },
    { key: "split", label: "Split", min: 0, max: 1, step: 0.01, value: 0.4, group: "Colour" },
    {
      key: "shadowHue",
      label: "Shadows",
      min: 0,
      max: 360,
      step: 1,
      value: 196,
      unit: "\xB0",
      precision: 0,
      group: "Colour",
      inert: (s) => s.split > 0 ? null : "Split is at zero \u2014 no tone to push."
    },
    {
      key: "highlightHue",
      label: "Highlights",
      min: 0,
      max: 360,
      step: 1,
      value: 38,
      unit: "\xB0",
      precision: 0,
      group: "Colour",
      inert: (s) => s.split > 0 ? null : "Split is at zero \u2014 no tone to push."
    },
    { key: "vignette", label: "Falloff", min: 0, max: 1, step: 0.01, value: 0.12, group: "Colour" }
  ];
  var SCHEMA = [...EXPOSURE_SCHEMA, ...DEVELOP_SCHEMA];
  function defaultParams() {
    const out = { stack: "mean" };
    for (const def of SCHEMA) out[def.key] = def.value;
    return out;
  }
  function formatParam(def, value) {
    return value.toFixed(def.precision ?? 2) + (def.unit ?? "");
  }
  function inertReason(def, state) {
    return def.inert?.(state) ?? null;
  }
  return __toCommonJS(global_exports);
})();