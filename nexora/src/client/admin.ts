import '../styles/admin.css';

// Confirmation avant les suppressions (le serveur reste seul juge : ceci n'est qu'un garde-fou).
document.querySelectorAll<HTMLFormElement>('form[data-confirm]').forEach((form) => {
  form.addEventListener('submit', (e) => {
    if (!window.confirm(form.dataset.confirm ?? 'Confirmer ?')) e.preventDefault();
  });
});

// Listes déroulantes qui s'appliquent immédiatement (position sur l'accueil).
document.querySelectorAll<HTMLSelectElement>('select[data-autosubmit]').forEach((select) => {
  select.addEventListener('change', () => select.form?.requestSubmit());
});

// Envoi d'images : glisser-déposer + nombre de fichiers choisis + état « envoi en cours ».
document.querySelectorAll<HTMLFormElement>('form[data-upload]').forEach((form) => {
  const input = form.querySelector<HTMLInputElement>('input[type=file]');
  const label = form.querySelector<HTMLElement>('[data-upload-label]');
  const drop = form.querySelector<HTMLElement>('.upload__drop');
  const submit = form.querySelector<HTMLButtonElement>('[data-upload-submit]');
  if (!input || !drop) return;
  const update = () => {
    const n = input.files?.length ?? 0;
    if (label) label.textContent = n ? `${n} fichier(s) sélectionné(s)` : 'ou les déposer ici';
  };
  input.addEventListener('change', update);
  ['dragenter', 'dragover'].forEach((t) =>
    drop.addEventListener(t, (e) => {
      e.preventDefault();
      drop.classList.add('is-over');
    }),
  );
  ['dragleave', 'drop'].forEach((t) => drop.addEventListener(t, () => drop.classList.remove('is-over')));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    if (e.dataTransfer?.files.length) {
      input.files = e.dataTransfer.files;
      update();
    }
  });
  form.addEventListener('submit', () => {
    if (submit) {
      submit.disabled = true;
      submit.textContent = 'Optimisation des images…';
    }
  });
});
