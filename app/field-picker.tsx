"use client";

export interface FieldOption {
  id: number;
  slug: string;
  name: string;
}

export const MAX_SELECTABLE_FIELDS = 2;

export function FieldPicker({
  fields,
  selected,
  onChange,
  disabled,
  legend,
}: {
  fields: FieldOption[];
  selected: number[];
  onChange: (fieldIds: number[]) => void;
  disabled: boolean;
  legend: string;
}) {
  function toggle(fieldId: number) {
    if (selected.includes(fieldId)) {
      onChange(selected.filter((id) => id !== fieldId));
    } else if (selected.length < MAX_SELECTABLE_FIELDS) {
      onChange([...selected, fieldId]);
    }
  }

  return (
    <fieldset className="field-picker" disabled={disabled}>
      <legend>
        <strong>{legend}</strong>
        <small>Choose up to {MAX_SELECTABLE_FIELDS}.</small>
      </legend>
      <div className="field-picker-options">
        {fields.map((field) => {
          const checked = selected.includes(field.id);
          const full = !checked && selected.length >= MAX_SELECTABLE_FIELDS;
          return (
            <label key={field.id} className={checked ? "selected" : undefined}>
              <input
                type="checkbox"
                checked={checked}
                disabled={disabled || full}
                onChange={() => toggle(field.id)}
              />
              <span>{field.name}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
