/* 桌面计划小人 v0.2 —— Sprite + 状态机（纯 SVG + CSS 动画，零依赖）
 *
 * 六种状态（Pet.setState 由 app.js 按计划数据驱动调用）：
 *   idle     待机        呼吸 + 眨眼，气泡显示接下来要做什么
 *   working  工作中      身体快速上下小幅起伏 + 手臂敲击
 *   break    休息中      左右摇摆 + 端茶杯
 *   happy    达标/全完成  跳跃庆祝 + 眼睛变弯 + 周围小星星
 *   tired    超载疲惫    缓慢摇晃 + 流汗
 *   sleeping 打瞌睡      眼睛闭合 + Zzz 上浮（深夜或无计划）
 *
 * 兼容性：本文件禁用 ?. ?? replaceAll 等 ES2020+ 语法（与 app.js 同规则）。
 */
(function () {
  'use strict';

  var SVG = [
    '<svg class="pet-svg" viewBox="0 0 120 130" width="96" height="104" aria-hidden="true">',
    '  <ellipse class="pet-shadow" cx="60" cy="122" rx="26" ry="5" fill="#0f172a" opacity=".12"/>',
    '  <g class="pet-all">',
    '    <g class="pet-stars">',
    '      <text class="pet-star s1" x="18" y="30" font-size="14">✦</text>',
    '      <text class="pet-star s2" x="96" y="22" font-size="12">✦</text>',
    '      <text class="pet-star s3" x="102" y="52" font-size="10">✦</text>',
    '    </g>',
    '    <g class="pet-zzz">',
    '      <text class="pet-z z1" x="86" y="34" font-size="13">Z</text>',
    '      <text class="pet-z z2" x="96" y="24" font-size="11">z</text>',
    '      <text class="pet-z z3" x="104" y="16" font-size="9">z</text>',
    '    </g>',
    '    <path class="pet-sweat" d="M94 40 q5 8 0 12 q-5 -4 0 -12" fill="#7dd3fc"/>',
    '    <g class="pet-body">',
    '      <line class="pet-antenna" x1="60" y1="26" x2="60" y2="14" stroke="#4f6ef7" stroke-width="3" stroke-linecap="round"/>',
    '      <circle class="pet-antenna-ball" cx="60" cy="11" r="4" fill="#f59e0b"/>',
    '      <path class="pet-body-shape" d="M28 62 q0 -38 32 -38 q32 0 32 38 q0 40 -32 40 q-32 0 -32 -40" fill="#dbe4ff" stroke="#4f6ef7" stroke-width="3"/>',
    '      <g class="pet-face">',
    '        <g class="pet-eyes">',
    '          <circle class="pet-eye" cx="47" cy="56" r="4.5" fill="#1f2937"/>',
    '          <circle class="pet-eye" cx="73" cy="56" r="4.5" fill="#1f2937"/>',
    '        </g>',
    '        <path class="pet-eyes-happy" d="M42 58 q5 -7 10 0 M68 58 q5 -7 10 0" fill="none" stroke="#1f2937" stroke-width="3" stroke-linecap="round"/>',
    '        <path class="pet-eyes-closed" d="M42 57 h11 M68 57 h11" fill="none" stroke="#1f2937" stroke-width="3" stroke-linecap="round"/>',
    '        <circle class="pet-blush" cx="40" cy="66" r="4" fill="#fbcfe8"/>',
    '        <circle class="pet-blush" cx="80" cy="66" r="4" fill="#fbcfe8"/>',
    '        <path class="pet-mouth" d="M55 68 q5 5 10 0" fill="none" stroke="#1f2937" stroke-width="2.5" stroke-linecap="round"/>',
    '        <path class="pet-mouth-smile" d="M54 67 q6 8 12 0 q-6 3 -12 0" fill="#1f2937"/>',
    '      </g>',
    '      <g class="pet-arm arm-l"><rect x="16" y="62" width="14" height="7" rx="3.5" fill="#4f6ef7"/></g>',
    '      <g class="pet-arm arm-r"><rect x="90" y="62" width="14" height="7" rx="3.5" fill="#4f6ef7"/></g>',
    '      <g class="pet-cup">',
    '        <rect x="88" y="76" width="16" height="12" rx="2" fill="#fff" stroke="#b45309" stroke-width="2"/>',
    '        <path d="M104 79 q6 3 0 6" fill="none" stroke="#b45309" stroke-width="2"/>',
    '        <path class="pet-steam" d="M93 72 q2 -4 0 -7 M97 72 q2 -4 0 -7" fill="none" stroke="#cbd5e1" stroke-width="2" stroke-linecap="round"/>',
    '      </g>',
    '    </g>',
    '  </g>',
    '</svg>',
  ].join('');

  var VALID = ['idle', 'working', 'break', 'happy', 'tired', 'sleeping'];
  var current = '';
  var root = null;
  var bubble = null;

  function mount() {
    root = document.getElementById('pet');
    if (!root || root.querySelector('.pet-svg')) return;
    root.insertAdjacentHTML('afterbegin', SVG);
    root.classList.add('st-idle');
    bubble = document.getElementById('pet-bubble');
  }

  /** 状态机：切换视觉状态 + 更新气泡文案（文案可为空表示不变） */
  function setState(state, message) {
    if (!root) mount();
    if (!root) return;
    if (VALID.indexOf(state) < 0) state = 'idle';
    if (state !== current) {
      root.classList.remove('st-' + current);
      root.classList.add('st-' + state);
      current = state;
    }
    if (bubble && typeof message === 'string' && message) bubble.textContent = message;
  }

  function getState() { return current; }

  // 页面加载后立即可见（app.js init 之前也显示待机状态）
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }

  window.Pet = { mount: mount, setState: setState, getState: getState };
})();
