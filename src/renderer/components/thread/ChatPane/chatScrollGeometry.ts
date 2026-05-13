export const BOTTOM_EPSILON_PX = 4;

export function isElementAtBottom(element: HTMLElement): boolean {
  return element.scrollHeight - element.scrollTop - element.clientHeight <= BOTTOM_EPSILON_PX;
}
