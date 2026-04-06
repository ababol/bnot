import AVFoundation

final class SoundEngine {
    private let engine = AVAudioEngine()
    private let playerNode = AVAudioPlayerNode()
    private let sampleRate: Double = 44100

    init() {
        engine.attach(playerNode)
        engine.connect(playerNode, to: engine.mainMixerNode, format: nil)
        engine.mainMixerNode.outputVolume = 0.3
        try? engine.start()
    }

    func playApproval() {
        // Rising two-tone: C5 -> E5
        playSquareWave(tones: [(523, 0.08), (659, 0.10)])
    }

    func playDeny() {
        // Falling: E4 -> C4
        playSquareWave(tones: [(330, 0.10), (262, 0.12)])
    }

    func playComplete() {
        // Happy jingle: C5 -> E5 -> G5
        playSquareWave(tones: [(523, 0.08), (659, 0.08), (784, 0.14)])
    }

    func playAlert() {
        // Double beep: A5, pause, A5
        playSquareWave(tones: [(880, 0.06), (0, 0.04), (880, 0.06)])
    }

    private func playSquareWave(tones: [(frequency: Double, duration: Double)]) {
        let totalDuration = tones.reduce(0) { $0 + $1.duration }
        let frameCount = AVAudioFrameCount(sampleRate * totalDuration)

        guard let format = AVAudioFormat(standardFormatWithSampleRate: sampleRate, channels: 1),
              let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frameCount) else { return }

        buffer.frameLength = frameCount
        guard let data = buffer.floatChannelData?[0] else { return }

        var offset = 0
        for (freq, dur) in tones {
            let frames = Int(sampleRate * dur)
            for i in 0..<frames {
                let t = Double(i) / sampleRate
                // Square wave for 8-bit feel
                let sample: Float = freq > 0 ? (sin(2.0 * .pi * freq * t) > 0 ? 0.15 : -0.15) : 0
                data[offset + i] = sample
            }
            offset += frames
        }

        playerNode.scheduleBuffer(buffer, completionHandler: nil)
        if !playerNode.isPlaying { playerNode.play() }
    }
}
