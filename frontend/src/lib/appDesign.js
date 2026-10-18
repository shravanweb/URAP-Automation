// Pure helpers the app designer uses to change a page's component tree. Containers (form, card)
// hold one level of children; containers cannot be nested.
import { COMPONENTS, allComponents, newComponent } from './appDefinition.js';

export const SPAN_OPTIONS = [[3, '¼'], [4, '⅓'], [6, '½'], [8, '⅔'], [12, 'Full']];

const clone = (value) => JSON.parse(JSON.stringify(value));

export function findInPage(page, id) {
  for (const [index, component] of (page.components || []).entries()) {
    if (component.id === id) return { component, parent: null, index };
    for (const [childIndex, child] of (component.children || []).entries()) {
      if (child.id === id) return { component: child, parent: component, index: childIndex };
    }
  }
  return null;
}

/** Inserts a component into the page (parentId null = top level). Returns a new page. */
export function insertComponent(page, component, parentId = null, index = null) {
  const next = clone(page);
  const isContainer = COMPONENTS[component.type]?.container;
  let parent = parentId ? next.components.find((item) => item.id === parentId) : null;
  if (parent && (!COMPONENTS[parent.type]?.container || isContainer)) {
    // Containers can't go inside containers: place it after the container instead.
    const position = next.components.indexOf(parent);
    parent = null;
    index = position + 1;
  }
  const list = parent ? (parent.children ||= []) : next.components;
  const at = index === null || index === undefined || index > list.length || index < 0 ? list.length : index;
  list.splice(at, 0, component);
  return next;
}

export function removeComponent(page, id) {
  const next = clone(page);
  next.components = next.components.filter((item) => item.id !== id).map((item) => (item.children ? { ...item, children: item.children.filter((child) => child.id !== id) } : item));
  return next;
}

export function updateComponent(page, id, update) {
  const apply = (item) => (item.id === id ? (typeof update === 'function' ? update(item) : { ...item, ...update }) : item);
  return {
    ...page,
    components: (page.components || []).map((item) => {
      const next = apply(item);
      return next.children ? { ...next, children: next.children.map(apply) } : next;
    }),
  };
}

/** Moves a component to (parentId, index); index refers to the list before removal. */
export function moveComponent(page, id, parentId = null, index = null) {
  const found = findInPage(page, id);
  if (!found) return page;
  if (parentId === id) return page;
  const sameList = (found.parent?.id || null) === (parentId || null);
  let target = index;
  if (sameList && target !== null && target > found.index) target -= 1;
  return insertComponent(removeComponent(page, id), found.component, parentId, target);
}

/** Copies a component (and its children) with fresh ids, placed right after the original. */
export function duplicateComponent(page, id, definition) {
  const found = findInPage(page, id);
  if (!found) return { page, id: null };
  const taken = allComponents(definition).map((item) => item.id);
  const copyOf = (component) => {
    const fresh = newComponent(component.type, taken);
    taken.push(fresh.id);
    const copy = { ...clone(component), id: fresh.id };
    if (COMPONENTS[component.type]?.input) copy.props = { ...copy.props, name: fresh.props.name };
    if (copy.children) copy.children = copy.children.map(copyOf);
    return copy;
  };
  const copy = copyOf(found.component);
  return { page: insertComponent(page, copy, found.parent?.id || null, found.index + 1), id: copy.id };
}

/** Binding suggestions for the property panel: [{ path, label, group }]. */
export function bindingSuggestions(definition, page) {
  const out = [
    { path: 'app.user.name', label: 'Signed-in user’s name', group: 'App' },
    { path: 'app.user.email', label: 'Signed-in user’s email', group: 'App' },
    { path: 'app.name', label: 'App name', group: 'App' },
  ];
  for (const name of page?.inputs || []) out.push({ path: `page.inputs.${name}`, label: `Page input ${name}`, group: 'Page' });
  for (const component of allComponents(page || {})) {
    if (COMPONENTS[component.type]?.input && component.props?.name) out.push({ path: `inputs.${component.props.name}`, label: component.props.label || component.props.name, group: 'Fields' });
  }
  for (const source of definition?.dataSources || []) {
    out.push({ path: `data.${source.name}.rows`, label: `${source.name} rows`, group: 'Data' });
    out.push({ path: `data.${source.name}.count`, label: `${source.name} row count`, group: 'Data' });
    out.push({ path: `data.${source.name}.rows[0]`, label: `${source.name} first row`, group: 'Data' });
  }
  const vars = new Set((definition?.variables || []).map((item) => item.name));
  for (const component of allComponents(definition || { pages: [] })) {
    for (const actions of Object.values(component.events || {})) for (const action of actions || []) if (action.resultVar) vars.add(action.resultVar);
  }
  for (const name of vars) out.push({ path: `vars.${name}`, label: `Variable ${name}`, group: 'Variables' });
  out.push({ path: 'result.output', label: 'Previous action’s output', group: 'Actions' });
  out.push({ path: 'result.status', label: 'Previous action’s status', group: 'Actions' });
  return out;
}
