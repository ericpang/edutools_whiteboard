// The "enter a board code" form, used on the landing page and on the student page.
import { goTo } from './nav.js';
import { isValidCode, normalizeCode } from './util.js';

export function wireCodeForm({ form, input, error }) {
  input.addEventListener('input', () => {
    input.value = normalizeCode(input.value).slice(0, 6);
    error.textContent = '';
    input.removeAttribute('aria-invalid');
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const code = normalizeCode(input.value);
    if (isValidCode(code)) {
      goTo('student.html', { code });
      return;
    }
    input.setAttribute('aria-invalid', 'true');
    error.textContent = code.length === 6 ? 'Codes never use 0, O, 1, I or L. Check it with your teacher.' : 'Board codes have 6 letters and numbers.';
    input.focus();
  });
}
