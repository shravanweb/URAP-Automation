import { useEffect, useState } from 'react';
import { inputClass } from './ui.jsx';
import { CONTROL_TYPES, SELECTOR_TYPES, fieldsFor, parseList, setConfigValue } from '../lib/activityFields.js';

const small = `${inputClass} mt-1`;

function JsonField({ field, value, onChange }) {
  const [text, setText] = useState(value === undefined ? '' : JSON.stringify(value, null, 2));
  const [bad, setBad] = useState(false);
  useEffect(() => { setText(value === undefined ? '' : JSON.stringify(value, null, 2)); setBad(false); }, [JSON.stringify(value)]);
  return (
    <>
      <textarea className={`${small} font-mono`} rows="3" placeholder={field.placeholder} value={text} onChange={(event) => {
        setText(event.target.value);
        if (!event.target.value.trim()) { setBad(false); onChange(undefined); return; }
        try { onChange(JSON.parse(event.target.value)); setBad(false); } catch { setBad(true); }
      }} />
      {bad && <span className="text-[11px] text-danger">Not valid JSON yet</span>}
    </>
  );
}

function SelectorField({ config, onConfig, picks }) {
  return (
    <div className="mt-1 grid grid-cols-[minmax(0,1fr)_7rem] gap-1">
      <input className={inputClass} aria-label="Selector" placeholder="#id, //xpath, Save" value={config.selector ?? ''} onChange={(event) => onConfig(setConfigValue(config, 'selector', event.target.value))} />
      <select className={inputClass} aria-label="Selector type" value={config.selectorType || 'auto'} onChange={(event) => onConfig(setConfigValue(config, 'selectorType', event.target.value))}>
        {SELECTOR_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select>
      {picks?.length > 0 && (
        <select className={`${inputClass} col-span-2`} aria-label="Use a picked selector" value="" onChange={(event) => { const [selectorType, ...rest] = event.target.value.split(':'); if (rest.length) onConfig({ ...config, selector: rest.join(':'), selectorType }); }}>
          <option value="">Use a selector picked in the recorder…</option>
          {picks.flatMap((pick, index) => pick.element.candidates.map((candidate) => (
            <option key={`${index}-${candidate.selectorType}-${candidate.selector}`} value={`${candidate.selectorType}:${candidate.selector}`}>{candidate.selectorType}: {candidate.selector}</option>
          )))}
        </select>
      )}
      <input type="number" min="0" className={inputClass} aria-label="Match index" placeholder="Match # (empty = first)" value={config.index ?? ''} onChange={(event) => onConfig(setConfigValue(config, 'index', event.target.value === '' ? undefined : Number(event.target.value)))} />
      <input className={inputClass} aria-label="Frame" placeholder="iframe (optional)" value={config.frame ?? ''} onChange={(event) => onConfig(setConfigValue(config, 'frame', event.target.value))} />
    </div>
  );
}

function DesktopSelectorField({ value, onChange }) {
  const current = value && typeof value === 'object' ? value : {};
  const set = (key, next) => {
    const updated = { ...current };
    if (next === '' || next === undefined) delete updated[key]; else updated[key] = next;
    onChange(Object.keys(updated).length ? updated : undefined);
  };
  return (
    <div className="mt-1 grid grid-cols-2 gap-1">
      <input className={inputClass} placeholder="Name" aria-label="Element name" value={current.name ?? ''} onChange={(event) => set('name', event.target.value)} />
      <input className={inputClass} placeholder="AutomationId" aria-label="AutomationId" value={current.automationId ?? ''} onChange={(event) => set('automationId', event.target.value)} />
      <select className={inputClass} aria-label="Control type" value={current.controlType ?? ''} onChange={(event) => set('controlType', event.target.value)}><option value="">Any control</option>{CONTROL_TYPES.map((type) => <option key={type}>{type}</option>)}</select>
      <input className={inputClass} placeholder="ClassName" aria-label="ClassName" value={current.className ?? ''} onChange={(event) => set('className', event.target.value)} />
    </div>
  );
}

/** Form for the selected activity. Changes go straight into step.config. */
export default function PropertyPanel({ step, connections = [], picks = [], onConfig }) {
  const fields = fieldsFor(step.type);
  if (!fields || !fields.length) return null;
  const config = step.config || {};
  const set = (key, value) => onConfig(setConfigValue(config, key, value));
  return (
    <div className="mt-3 space-y-2" data-testid="property-panel">
      {fields.map((field) => {
        const id = `${step.id}-${field.key}`;
        let control;
        if (field.kind === 'selector') control = <SelectorField config={config} onConfig={onConfig} picks={picks} />;
        else if (field.kind === 'desktopSelector') control = <DesktopSelectorField value={config[field.key]} onChange={(value) => set(field.key, value)} />;
        else if (field.kind === 'checkbox') {
          const checked = config[field.key] === undefined ? Boolean(field.defaultValue) : config[field.key] === true;
          return <label key={field.key} className="flex items-center gap-2 text-xs font-medium"><input id={id} type="checkbox" checked={checked} onChange={(event) => set(field.key, event.target.checked)} />{field.label}</label>;
        } else if (field.kind === 'select') control = <select id={id} className={small} value={config[field.key] ?? field.options[0][0]} onChange={(event) => set(field.key, event.target.value)}>{field.options.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>;
        else if (field.kind === 'number') control = <input id={id} type="number" className={small} placeholder={field.placeholder} value={config[field.key] ?? ''} onChange={(event) => set(field.key, event.target.value === '' ? undefined : Number(event.target.value))} />;
        else if (field.kind === 'textarea') control = <textarea id={id} className={small} rows="3" placeholder={field.placeholder} value={config[field.key] ?? ''} onChange={(event) => set(field.key, event.target.value)} />;
        else if (field.kind === 'list') control = <input id={id} className={small} placeholder={field.placeholder} value={Array.isArray(config[field.key]) ? config[field.key].join(', ') : (config[field.key] ?? '')} onChange={(event) => set(field.key, parseList(event.target.value))} />;
        else if (field.kind === 'json') control = <JsonField field={field} value={config[field.key]} onChange={(value) => set(field.key, value)} />;
        else if (field.kind === 'connection' || field.kind === 'credential') {
          const types = field.kind === 'credential' ? ['credential'] : field.connectorTypes;
          const options = connections.filter((item) => types.includes(item.connectorType));
          control = (
            <>
              <select id={id} className={small} value={config[field.key] ?? ''} onChange={(event) => set(field.key, event.target.value)}>
                <option value="">{options.length ? 'Choose…' : `No ${types.join(' / ')} connection in this project`}</option>
                {options.map((item) => <option key={item.id} value={item.id}>{item.name} ({item.connectorType})</option>)}
              </select>
              {field.kind === 'credential' && config.credentialId !== undefined && (
                <input className={small} aria-label="Credential field" placeholder="password" value={config.credentialField ?? ''} onChange={(event) => set('credentialField', event.target.value)} />
              )}
            </>
          );
        } else control = <input id={id} className={small} placeholder={field.placeholder} value={typeof config[field.key] === 'object' ? JSON.stringify(config[field.key]) : (config[field.key] ?? '')} onChange={(event) => set(field.key, event.target.value)} />;
        return (
          <div key={field.key} className={field.advanced ? 'opacity-80' : ''}>
            <label htmlFor={id} className="block text-xs font-medium">{field.label}</label>
            {control}
            {field.help && <p className="mt-0.5 text-[11px] text-[#667077]">{field.help}</p>}
          </div>
        );
      })}
    </div>
  );
}
