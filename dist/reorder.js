export function installItemDrag({root, canStart, onDrop, onPreview, onCancel}) {
  let gesture = null;
  let frame = 0;
  let suppressClick = false;

  function id(card) {
    return card.dataset.egg || card.dataset.item;
  }

  function cards(container) {
    return [...container.children].filter(node => node.matches('.egg-card,.item-card'));
  }

  function clear() {
    const current = gesture;
    gesture = null;
    clearTimeout(current.timer);
    cancelAnimationFrame(frame);
    frame = 0;
    current.card.classList.remove('item-drag-source');
    current.ghost?.remove();
    document.body.classList.remove('item-dragging');
    if (root.hasPointerCapture(current.pointer)) root.releasePointerCapture(current.pointer);
    return current;
  }

  function preview() {
    frame = 0;
    if (!gesture?.active) return;
    const {ghost, card, container, x, y, offsetX, offsetY} = gesture;
    ghost.style.transform = `translate3d(${x - offsetX}px,${y - offsetY}px,0)`;
    const rect = container.getBoundingClientRect();
    if (container.scrollHeight > container.clientHeight) {
      const step = y < rect.top + 35 ? -7 : y > rect.bottom - 35 ? 7 : 0;
      const before = container.scrollTop;
      container.scrollTop += step;
      if (before !== container.scrollTop) frame = requestAnimationFrame(preview);
    }
    const target = document.elementFromPoint(x, y)?.closest('.egg-card,.item-card');
    if (!target || target === card || target.parentElement !== container) return;
    const order = cards(container);
    const from = order.indexOf(card);
    const to = order.indexOf(target);
    container.insertBefore(card, from < to ? target.nextSibling : target);
    onPreview();
  }

  function activate() {
    if (!gesture || !canStart()) return;
    const {card, pointer} = gesture;
    const rect = card.getBoundingClientRect();
    const ghost = card.cloneNode(true);
    ghost.classList.add('item-drag-ghost');
    if (card.matches('.item-card')) ghost.classList.add('count-dashboard');
    ghost.setAttribute('aria-hidden', 'true');
    ghost.inert = true;
    ghost.style.width = rect.width + 'px';
    ghost.style.height = rect.height + 'px';
    document.body.appendChild(ghost);
    Object.assign(gesture, {
      active: true, ghost,
      offsetX: gesture.startX - rect.left,
      offsetY: gesture.startY - rect.top,
    });
    suppressClick = true;
    card.classList.add('item-drag-source');
    document.body.classList.add('item-dragging');
    root.setPointerCapture(pointer);
    preview();
  }

  root.addEventListener('pointerdown', event => {
    if (gesture) return;
    suppressClick = false;
    if (!event.isPrimary || event.button !== 0 || !canStart()) return;
    const handle = event.target.closest('.egg-open,.item-name,.item-number');
    const card = handle?.closest('.egg-card,.count-dashboard .item-card');
    if (!card) return;
    gesture = {
      card, container: card.parentElement, pointer: event.pointerId,
      startX: event.clientX, startY: event.clientY,
      x: event.clientX, y: event.clientY,
      order: cards(card.parentElement).map(id), active: false,
    };
    gesture.timer = setTimeout(activate, 420);
  });

  root.addEventListener('pointermove', event => {
    if (!gesture || event.pointerId !== gesture.pointer) return;
    gesture.x = event.clientX;
    gesture.y = event.clientY;
    if (!gesture.active) {
      if (Math.hypot(gesture.x - gesture.startX, gesture.y - gesture.startY) > 9) clear();
      return;
    }
    event.preventDefault();
    if (!frame) frame = requestAnimationFrame(preview);
  }, {passive: false});

  root.addEventListener('pointerup', event => {
    if (!gesture || event.pointerId !== gesture.pointer) return;
    if (gesture.active) preview();
    const current = clear();
    if (!current.active) return;
    const order = cards(current.container).map(id);
    if (order.every((value, index) => value === current.order[index])) onCancel();
    else onDrop({egg: Boolean(current.card.dataset.egg), order});
  });

  function cancel() {
    if (!gesture) return;
    const current = clear();
    if (!current.active) return;
    for (const value of current.order) {
      const card = cards(current.container).find(node => id(node) === value);
      if (card) current.container.appendChild(card);
    }
    onCancel();
  }

  root.addEventListener('pointercancel', cancel);
  root.addEventListener('lostpointercapture', cancel);
  document.addEventListener('keydown', event => { if (event.key === 'Escape') cancel(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) cancel(); });
  window.addEventListener('blur', cancel);
  root.addEventListener('click', event => {
    if (!suppressClick) return;
    suppressClick = false;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);

  return {get active() { return Boolean(gesture?.active); }};
}