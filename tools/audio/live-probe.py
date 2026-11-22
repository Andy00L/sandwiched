import argparse
import json
import sys
import time

from playwright.sync_api import sync_playwright

COUNTERS = """
window.__audioProbe = { contexts: 0, starts: [], silencedGains: 0, frames: 0 };
const countFrame = () => { window.__audioProbe.frames++; requestAnimationFrame(countFrame); };
requestAnimationFrame(countFrame);
const NativeContext = window.AudioContext;
window.AudioContext = class extends NativeContext { constructor(...options) { super(...options); window.__audioProbe.contexts++; } };
const nativeStart = AudioBufferSourceNode.prototype.start;
AudioBufferSourceNode.prototype.start = function (...when) {
  const buffer = this.buffer;
  window.__audioProbe.starts.push({ rate: buffer ? buffer.sampleRate : 0, durationS: buffer ? buffer.duration : 0, playbackRate: this.playbackRate.value });
  return nativeStart.apply(this, when);
};
const nativeTarget = AudioParam.prototype.setTargetAtTime;
AudioParam.prototype.setTargetAtTime = function (target, ...timing) {
  if (target === 0) window.__audioProbe.silencedGains++;
  return nativeTarget.call(this, target, ...timing);
};
"""

PIANO_RATE = 24000
VOICE_MIN_S = 0.26


def count_sources(starts):
    return {
        'piano notes': sum(1 for start in starts if start['rate'] == PIANO_RATE),
        'paper sounds': sum(1 for start in starts if start['rate'] != PIANO_RATE and start['durationS'] < VOICE_MIN_S),
        'voices': sum(1 for start in starts if start['rate'] != PIANO_RATE and start['durationS'] >= VOICE_MIN_S),
        'pitched voices': sum(1 for start in starts if abs(start['playbackRate'] - 1) > 1e-6),
    }


def main():
    parser = argparse.ArgumentParser(description='Load the game page in headless Chrome, click once, and count what the audio engine plays.')
    parser.add_argument('--url', default='http://localhost:3000/')
    parser.add_argument('--listen-s', type=float, default=40)
    options = parser.parse_args()
    problems, voice_statuses = [], []
    with sync_playwright() as playwright:
        try:
            browser = playwright.chromium.launch(channel='chrome', headless=True, args=['--enable-gpu', '--ignore-gpu-blocklist'])
        except Exception:
            browser = playwright.chromium.launch(headless=True, args=['--enable-gpu', '--ignore-gpu-blocklist'])
        page = browser.new_page(viewport={'width': 640, 'height': 360})
        page.on('pageerror', lambda error: problems.append(f'page error: {error}'))
        page.on('console', lambda message: problems.append(f'{message.type}: {message.text}') if message.type == 'error' or '[loadVoiceFiles]' in message.text or '[unlock]' in message.text else None)
        page.on('response', lambda response: voice_statuses.append(response.status) if '/audio/' in response.url else None)
        page.add_init_script(COUNTERS)
        page.goto(options.url)
        page.wait_for_function('window.__papercraft && window.__papercraft.ready', timeout=300000)
        time.sleep(6)
        before = page.evaluate('window.__audioProbe')
        print('[live-probe] before any gesture:', json.dumps({'contexts': before['contexts'], 'sources started': len(before['starts']), 'voice requests': len(voice_statuses)}))
        if before['contexts'] or before['starts'] or voice_statuses:
            problems.append('audio started before the first gesture')
        page.mouse.click(320, 350)
        frames_at_click = before['frames']
        time.sleep(options.listen_s)
        after = page.evaluate('window.__audioProbe')
        frames_per_s = round((after['frames'] - frames_at_click) / (options.listen_s + 6), 1)
        print(f"[live-probe] {options.listen_s:.0f} s after one click:", json.dumps({'frames per s': frames_per_s, 'contexts': after['contexts'], **count_sources(after['starts'])}))
        print('[live-probe] voice file responses:', len(voice_statuses), 'statuses', sorted(set(voice_statuses)))
        silenced_before = after['silencedGains']
        page.keyboard.press('KeyM')
        time.sleep(0.5)
        print('[live-probe] gains the M key sent to 0:', page.evaluate('window.__audioProbe.silencedGains') - silenced_before)
        browser.close()
    print('[live-probe] problems:', problems if problems else 'none')
    return 1 if problems or not voice_statuses or set(voice_statuses) != {200} else 0


if __name__ == '__main__':
    sys.exit(main())
