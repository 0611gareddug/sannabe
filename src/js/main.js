// 진입점
import { protect } from './protect.js';
import { UI } from './ui.js';
import { Game } from './game.js';

protect();

function boot() {
  const ui = new UI();
  const game = new Game(ui);
  ui.init(game);
  if (__DEV__) window.__g = game; // eslint-disable-line no-undef
  const b = document.getElementById('boot');
  const done = () => { b.classList.add('off'); setTimeout(() => b.remove(), 500); };
  if (document.fonts && document.fonts.ready) Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 1500))]).then(done);
  else done();
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
