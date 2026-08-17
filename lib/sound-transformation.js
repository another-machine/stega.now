var SoundTransformationLib = (() => {
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
    SoundTransformation: () => SoundTransformation
  });

  // src/SoundTransformation.ts
  var SoundTransformation = class {
    audioContext;
    phaseVocoderNode = null;
    audioBuffer = null;
    pitchFactor = 1;
    speedFactor = 1;
    bpm = 0;
    destination = null;
    constructor({ audioContext }) {
      this.audioContext = audioContext;
    }
    async initialize({
      audioBuffer,
      processorJSPath,
      processorScriptTag,
      bpm,
      destination
    }) {
      if (!bpm) {
        throw new Error(
          "SoundTransformation.initialize requires bpm \u2014 use detectBPM(buffer) if you do not have one"
        );
      }
      this.bpm = bpm;
      this.audioBuffer = audioBuffer;
      if (processorScriptTag) {
        const workletCode = processorScriptTag.textContent || "";
        const blob = new Blob([workletCode], { type: "text/javascript" });
        const url = URL.createObjectURL(blob);
        await this.audioContext.audioWorklet.addModule(url);
      } else if (processorJSPath) {
        await this.audioContext.audioWorklet.addModule(processorJSPath);
      } else {
        throw new Error("Must provide a script tag or path to processor worklet");
      }
      this.phaseVocoderNode = new AudioWorkletNode(
        this.audioContext,
        "phase-vocoder-processor"
      );
      this.destination = destination ?? this.audioContext.destination;
      this.audioBuffer.connect(this.phaseVocoderNode);
      this.phaseVocoderNode.connect(this.destination);
    }
    /** The node carrying the transformed signal, once initialized. */
    get output() {
      return this.phaseVocoderNode;
    }
    /**
     * `when` schedules the change at a context time instead of applying it now.
     *
     * Immediate writes land on the next render quantum, which is up to 2.9 ms
     * away and not the same instant the caller thinks it happened. One voice
     * does not care. Several voices held against a clock do: the clock moves at
     * the caller's instant and the audio at the quantum boundary, and the gap
     * is charged to every change.
     */
    adjustSpeedToBPM(npm, when) {
      const speedRatio = npm / this.bpm;
      this.updateSpeed(speedRatio, when);
      return this.speedFactor;
    }
    /**
     * Semitones, and fractions of one. 3.5 is three and a half semitones, not
     * four: this multiplied by a step per whole semitone in a loop, so 3.5 ran
     * the loop four times and any fractional part was silently rounded up.
     * Repeated multiplication also drifted — twelve steps landed near 1.9999997
     * rather than 2.
     */
    adjustPitchBySemitones(semitones = 1, when) {
      this.updatePitch(Math.pow(2, semitones / 12), when);
      return this.pitchFactor;
    }
    /**
     * Release the graph. The source node is the caller's — stop it first if it
     * is still running.
     */
    dispose() {
      var _a, _b;
      (_a = this.audioBuffer) == null ? void 0 : _a.disconnect();
      (_b = this.phaseVocoderNode) == null ? void 0 : _b.disconnect();
      this.phaseVocoderNode = null;
      this.audioBuffer = null;
      this.destination = null;
    }
    updateSpeed(speed, when) {
      var _a, _b;
      const pitchFactorParam = (_a = this.phaseVocoderNode) == null ? void 0 : _a.parameters.get("pitchFactor");
      this.speedFactor = speed;
      const compensated = this.pitchFactor * 1 / this.speedFactor;
      if (when == null) {
        if (this.audioBuffer) this.audioBuffer.playbackRate.value = speed;
        pitchFactorParam.value = compensated;
        return;
      }
      (_b = this.audioBuffer) == null ? void 0 : _b.playbackRate.setValueAtTime(speed, when);
      pitchFactorParam.setValueAtTime(compensated, when);
    }
    updatePitch(pitch, when) {
      var _a;
      const pitchFactorParam = (_a = this.phaseVocoderNode) == null ? void 0 : _a.parameters.get("pitchFactor");
      this.pitchFactor = pitch;
      const compensated = this.pitchFactor * 1 / this.speedFactor;
      if (when == null) pitchFactorParam.value = compensated;
      else pitchFactorParam.setValueAtTime(compensated, when);
    }
  };
  return __toCommonJS(global_exports);
})();