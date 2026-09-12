// ============ ПОЗИЦИОНИРОВАНИЕ МЕНЮ И ПОДМЕНЮ ============
function positionContextMenu(menu, x, y) {
  // Сначала позиционируем меню, чтобы узнать его размеры
  menu.style.left = x + 'px';
  menu.style.top = y + 'px';

  const rect = menu.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let posX = x;
  let posY = y;

  if (x + rect.width > vw - 8) posX = Math.max(8, vw - rect.width - 8);
  if (y + rect.height > vh - 8) posY = Math.max(8, vh - rect.height - 8);

  menu.style.left = posX + 'px';
  menu.style.top = posY + 'px';
}

// Корректировка подменю: если справа не хватает места — открываем слева
function adjustSubmenus(menu) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  menu.querySelectorAll('.ctx-submenu').forEach(sub => {
    const content = sub.querySelector('.ctx-submenu-content');
    if (!content) return;

    const subRect = sub.getBoundingClientRect();
    // Примерная ширина подменю
    const contentWidth = 240;

    // Если справа не помещается — открываем слева
    if (subRect.right + contentWidth > vw - 8) {
      sub.classList.add('submenu-left');
    }

    // Корректировка по вертикали: если подменю выходит за нижний край
    requestAnimationFrame(() => {
      const contentRect = content.getBoundingClientRect();
      if (contentRect.bottom > vh - 8) {
        const overflow = contentRect.bottom - (vh - 8);
        content.style.top = `calc(-4px - ${overflow}px)`;
      }
    });
  });
}
