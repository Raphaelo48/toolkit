// ============ SIDEBAR TOGGLE ============
function toggleSidebar(side) {
  if (side === 'left') {
    state.sidebarLeftCollapsed = !state.sidebarLeftCollapsed;
    document.getElementById('app').classList.toggle('sidebar-left-collapsed', state.sidebarLeftCollapsed);
    document.body.classList.toggle('sidebar-left-is-collapsed', state.sidebarLeftCollapsed);
  } else {
    state.sidebarRightCollapsed = !state.sidebarRightCollapsed;
    document.getElementById('app').classList.toggle('sidebar-right-collapsed', state.sidebarRightCollapsed);
    document.body.classList.toggle('sidebar-right-is-collapsed', state.sidebarRightCollapsed);
  }
}
