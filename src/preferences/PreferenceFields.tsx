import type { PreferenceField } from './registry';

/** Shared controls for trusted module contributions; values are saved through their owning section. */
export function PreferenceFields({ fields }: { fields: readonly PreferenceField[] }) {
  return <div className="space-y-4">{fields.map(field => <div key={field.id} className="space-y-1">
    <label htmlFor={`preference-${field.id}`} className="block font-semibold">{field.label}</label>
    <input id={`preference-${field.id}`} aria-describedby={`description-${field.id}`} type={field.control === 'toggle' ? 'checkbox' : field.control}
      checked={field.control === 'toggle' ? Boolean(field.value) : undefined} value={field.control === 'toggle' ? undefined : String(field.value)}
      min={field.min} max={field.max} step={field.step}
      onChange={event => {
        if (field.control === 'toggle') field.onChange(event.target.checked);
        else if (field.control === 'number') {
          const value = event.target.valueAsNumber;
          if (Number.isFinite(value) && (field.min === undefined || value >= field.min) && (field.max === undefined || value <= field.max)) field.onChange(value);
        } else field.onChange(event.target.value);
      }} className={field.control === 'toggle' ? 'h-4 w-4' : 'w-full rounded-lg border border-stone-300 bg-white px-3 py-2'} />
    <p id={`description-${field.id}`} className="text-xs text-stone-500">{field.description}</p>
  </div>)}</div>;
}
