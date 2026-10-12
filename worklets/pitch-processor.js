// Frame timestamps describe the center of the captured samples in the
// shared AudioContext timeline. Posting to the main thread adds unpredictable
// latency and must not be used as the observed musical time.
class PitchProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this._history = new Float32Array(8192)
    this._received = 0
    this._monoHop = 0
    this._polyHop = 0
    this._previousRms = 0
    this._slowRms = 0
    this._lastOnsetFrame = -Infinity
  }

  process(inputs) {
    const input = inputs[0]?.[0]
    if (!input || input.length === 0) return true
    this._history.copyWithin(0, input.length)
    this._history.set(input, this._history.length - input.length)
    // Estimate the envelope over ~21ms, updated every worklet quantum. Using
    // just 128 samples makes the slow E2 waveform itself resemble fresh
    // attacks whenever a partial cycle happens to be louder.
    // This detects an amplitude onset, NOT proof of a correctly played note.
    let energy = 0
    for (let i = this._history.length - 1024; i < this._history.length; i++) {
      energy += this._history[i] * this._history[i]
    }
    const rms = Math.sqrt(energy / 1024)
    const noiseFloor = 0.0075
    const risingFromSilence = this._previousRms < noiseFloor && rms >= noiseFloor
    const renewedAttack = this._previousRms >= noiseFloor &&
      rms > this._previousRms * 1.13 &&
      rms > this._slowRms * 1.4
    if (
      (risingFromSilence || renewedAttack) &&
      currentFrame - this._lastOnsetFrame > sampleRate * 0.09
    ) {
      this._lastOnsetFrame = currentFrame
    }
    this._previousRms = rms
    this._slowRms = this._slowRms * 0.97 + rms * 0.03
    this._received += input.length
    this._monoHop += input.length
    this._polyHop += input.length
    const endFrame = currentFrame + input.length
    const recentOnset = (windowFrames) =>
      this._lastOnsetFrame >= endFrame - windowFrames &&
      this._lastOnsetFrame <= endFrame
        ? this._lastOnsetFrame / sampleRate
        : null
    if (this._received >= 2048 && this._monoHop >= 2048) {
      this._monoHop %= 2048
      this.port.postMessage({
        type: 'mono',
        samples: this._history.slice(-2048),
        sampleRate,
        contextTimeS: (endFrame - 1024) / sampleRate,
        onsetContextTimeS: recentOnset(2048),
      })
    }
    if (this._received >= 8192 && this._polyHop >= 4096) {
      this._polyHop %= 4096
      this.port.postMessage({
        type: 'poly',
        samples: this._history.slice(),
        sampleRate,
        contextTimeS: (endFrame - 4096) / sampleRate,
        onsetContextTimeS: recentOnset(8192),
      })
    }
    return true
  }
}
registerProcessor('pitch-processor', PitchProcessor)
