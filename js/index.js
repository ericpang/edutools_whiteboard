// Landing page: join a board by code, or go and start one. No Firebase here, so it loads fast.
import { wireCodeForm } from './code-form.js';
import { mountDoodle } from './doodle.js';
import { pageUrl } from './nav.js';
import { $, hydrateIcons } from './ui.js';

hydrateIcons();
mountDoodle($('#doodle'));
wireCodeForm({ form: $('#join'), input: $('#code'), error: $('#code-error') });

// A real link, so Ctrl-click and middle-click work; the address just carries the emulator switch along.
$('#start').href = pageUrl('admin.html');
