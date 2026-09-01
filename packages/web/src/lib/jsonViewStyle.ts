import type { ComponentProps } from "react";
import type { JsonView } from "react-json-view-lite";

/**
 * `StyleProps` isn't part of the package's public export surface (only the
 * component and a couple of helpers are), so its shape is pulled off the
 * `style` prop instead of an internal subpath import.
 */
type JsonViewStyle = NonNullable<ComponentProps<typeof JsonView>["style"]>;

/**
 * Full class-name override for `react-json-view-lite`'s raw JSON tree. We
 * skip the package's own stylesheet entirely (its classes are content-hashed
 * and only ship a light palette) and point every field at classes defined in
 * `index.css`, which resolve through the same `--color-*` tokens the rest of
 * the app uses — so the tree follows light/dark for free instead of needing
 * a second theme object swapped in `useTheme`.
 */
export const wiretapJsonStyle: JsonViewStyle = {
  container: "jv-container",
  basicChildStyle: "jv-row",
  childFieldsContainer: "jv-children",
  label: "jv-label",
  clickableLabel: "jv-label jv-label-clickable",
  stringValue: "jv-string",
  numberValue: "jv-number",
  booleanValue: "jv-boolean",
  nullValue: "jv-null",
  undefinedValue: "jv-null",
  otherValue: "jv-other",
  punctuation: "jv-punctuation",
  expandIcon: "jv-icon jv-icon-expand",
  collapseIcon: "jv-icon jv-icon-collapse",
  collapsedContent: "jv-collapsed",
  noQuotesForStringValues: false,
  quotesForFieldNames: true,
  stringifyStringValues: true,
  ariaLables: { collapseJson: "Collapse", expandJson: "Expand" },
};
