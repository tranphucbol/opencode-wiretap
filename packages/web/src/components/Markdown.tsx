import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/** The only part of the mdast shape this file touches. */
type MdNode = { type: string; children?: MdNode[] };

/**
 * Keep HTML-looking source visible.
 *
 * Assistant text is full of angle-bracket tags that are not HTML at all —
 * `<system-reminder>`, `<available_skills>`, `<dcp-message-id>`. remark parses
 * those into `html` nodes, and react-markdown drops `html` nodes on the floor
 * unless `rehype-raw` is in the pipeline. Dropping them would make a wiretap
 * lie about what the model actually sent, and `rehype-raw` would instead
 * *execute* them as markup. Re-typing the node as `text` renders the source
 * verbatim, which is the only answer that keeps the capture faithful.
 */
function remarkHtmlAsText() {
  return (tree: MdNode) => {
    const walk = (node: MdNode) => {
      if (!node.children) return;
      for (const child of node.children) {
        if (child.type === "html") child.type = "text";
        walk(child);
      }
    };
    walk(tree);
  };
}

const PLUGINS = [remarkGfm, remarkHtmlAsText];

/**
 * Rendered markdown for assistant prose. Raw HTML is never executed —
 * react-markdown only emits markup it built itself, and the plugin above
 * turns anything tag-shaped back into literal text.
 */
export function Markdown({ text }: { text: string }) {
  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={PLUGINS}
        components={{
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noreferrer noopener">
              {children}
            </a>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
