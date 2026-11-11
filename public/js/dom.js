// dom.js - tiny helpers for working with the page.

export const $ = (id) => document.getElementById(id);

/**
 * Create an element: el('li', { className: 'player' }, 'Ana')
 * Text is always set with textContent, never innerHTML, so a player name like
 * "<script>..." is shown as plain text and can never run as code.
 */
export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  Object.assign(node, props);
  for (const child of children) {
    node.append(child); // strings become text nodes
  }
  return node;
}

const SCREENS = ['home', 'lobby', 'generating', 'game', 'interrogation'];

export function showScreen(name) {
  for (const screen of SCREENS) $(`screen-${screen}`).hidden = screen !== name;
}

export function showBanner(text) {
  $('banner').textContent = text;
  $('banner').hidden = !text;
}
