export const Field = ({
  label,
  name,
  value,
  type = 'text',
  required,
  max,
  error,
  hint,
  autocomplete,
}: {
  label: string;
  name: string;
  value: string;
  type?: string;
  required?: boolean;
  max?: number;
  error?: string;
  hint?: string;
  autocomplete?: string;
}) => {
  const id = `f-${name.replace(/[^a-zA-Z0-9]/g, '-')}`;
  return (
    <div class="field">
      <label for={id}>
        {label}
        {required ? ' *' : ''}
      </label>
      <input
        id={id}
        name={name}
        type={type}
        value={value}
        required={required}
        maxlength={max}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={hint || error ? `${id}-desc` : undefined}
        autocomplete={autocomplete}
      />
      <p class={error ? 'field__error' : 'field__hint'} id={`${id}-desc`}>
        {error ?? hint}
      </p>
    </div>
  );
};
