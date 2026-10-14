/**
 * Formulaire de contact : affiché directement dans la page, envoyé en arrière-plan.
 * Le succès n'est affiché QUE si le serveur confirme l'enregistrement (HTTP 201). En cas d'erreur, les champs
 * restent remplis. Sans JavaScript, le formulaire s'envoie normalement (POST /contact).
 */
type Errors = Record<string, string>;

const MESSAGES: Record<string, string> = {
  name: 'Indiquez votre nom.',
  email: 'Indiquez une adresse e-mail valide (ex. : nom@entreprise.fr).',
  phone: 'Numéro de téléphone invalide.',
  projectType: 'Choisissez un type de projet.',
  message: 'Décrivez votre projet en quelques mots (10 caractères minimum).',
};

export function initContactForm() {
  const form = document.querySelector<HTMLFormElement>('[data-contact-form]');
  if (!form) return;

  const status = form.querySelector<HTMLElement>('[data-form-status]')!;
  const statusText = form.querySelector<HTMLElement>('[data-status-text]')!;
  const okIcon = form.querySelector<HTMLElement>('[data-status-ok]')!;
  const errIcon = form.querySelector<HTMLElement>('[data-status-err]')!;
  const submit = form.querySelector<HTMLButtonElement>('[data-submit]')!;
  const submitLabel = form.querySelector<HTMLElement>('[data-submit-label]')!;
  const typeSelect = form.querySelector<HTMLSelectElement>('#cf-type');

  // « Parler de ce projet » (services) : le type de projet est présélectionné, le défilement reste natif (ancre).
  document.querySelectorAll<HTMLAnchorElement>('[data-project-type]').forEach((a) =>
    a.addEventListener('click', () => {
      const t = a.dataset.projectType;
      if (typeSelect && t && [...typeSelect.options].some((o) => o.value === t)) typeSelect.value = t;
    }),
  );

  // Retour du formulaire sans JavaScript (?envoi=ok) : confirmation affichée.
  const params = new URLSearchParams(location.search);
  if (params.get('envoi') === 'ok') {
    setStatus('ok', form.dataset.success ?? 'Merci, votre demande a bien été enregistrée.');
  }

  function setStatus(kind: 'ok' | 'error' | 'busy' | 'idle', text: string) {
    status.classList.toggle('is-ok', kind === 'ok');
    status.classList.toggle('is-error', kind === 'error');
    okIcon.hidden = kind !== 'ok';
    errIcon.hidden = kind !== 'error';
    statusText.textContent = text;
  }

  function showErrors(errors: Errors) {
    let first: HTMLElement | null = null;
    form!.querySelectorAll<HTMLElement>('[data-error-for]').forEach((p) => {
      const field = p.dataset.errorFor!;
      const input = form!.elements.namedItem(field) as HTMLElement | null;
      const msg = errors[field] ?? '';
      p.textContent = msg;
      if (input) {
        if (msg) input.setAttribute('aria-invalid', 'true');
        else input.removeAttribute('aria-invalid');
        if (msg && !first) first = input;
      }
    });
    (first as HTMLElement | null)?.focus();
  }

  function validate(data: FormData): Errors {
    const e: Errors = {};
    const s = (k: string) => String(data.get(k) ?? '').trim();
    if (!s('name')) e.name = MESSAGES.name;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s('email'))) e.email = MESSAGES.email;
    if (s('phone') && !/^[+0-9 ().-]{6,30}$/.test(s('phone'))) e.phone = MESSAGES.phone;
    if (!s('projectType')) e.projectType = MESSAGES.projectType;
    if (s('message').length < 10) e.message = MESSAGES.message;
    return e;
  }

  // Effacer l'erreur d'un champ dès qu'il est corrigé.
  form.addEventListener('input', (ev) => {
    const t = ev.target as HTMLInputElement;
    if (t.getAttribute('aria-invalid') === 'true') {
      t.removeAttribute('aria-invalid');
      const p = form.querySelector<HTMLElement>(`[data-error-for="${t.name}"]`);
      if (p) p.textContent = '';
    }
  });

  let sending = false;
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if (sending) return;
    const data = new FormData(form);
    const errors = validate(data);
    showErrors(errors);
    if (Object.keys(errors).length) {
      setStatus('error', 'Certains champs sont à corriger.');
      return;
    }
    // Aperçu hors ligne (scripts/snapshot.mjs) : aucun serveur pour enregistrer la demande.
    if (form.dataset.apercu) {
      setStatus('error', 'Aperçu hors ligne : l’envoi fonctionne uniquement sur le site en ligne. Rien n’a été envoyé.');
      return;
    }
    sending = true;
    submit.disabled = true;
    submit.setAttribute('aria-busy', 'true');
    const original = submitLabel.textContent;
    submitLabel.textContent = 'Envoi en cours…';
    setStatus('busy', '');
    try {
      const res = await fetch('/contact', {
        method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify(Object.fromEntries(data.entries())),
        credentials: 'same-origin',
      });
      const body = (await res.json().catch(() => ({}))) as { message?: string; errors?: Errors };
      if (res.status === 201) {
        form.reset();
        showErrors({});
        setStatus('ok', body.message ?? form.dataset.success ?? 'Merci, votre demande a bien été enregistrée.');
      } else if (res.status === 422 && body.errors) {
        showErrors(body.errors);
        setStatus('error', body.message ?? 'Certains champs sont à corriger.');
      } else {
        setStatus('error', body.message ?? 'L’envoi n’a pas abouti. Vos informations sont conservées : réessayez dans un instant.');
      }
    } catch {
      setStatus('error', 'Connexion impossible. Vos informations sont conservées : vérifiez votre connexion puis réessayez.');
    } finally {
      sending = false;
      submit.disabled = false;
      submit.removeAttribute('aria-busy');
      submitLabel.textContent = original;
    }
  });
}
