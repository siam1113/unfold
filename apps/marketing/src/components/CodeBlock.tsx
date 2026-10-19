import { useState } from "react";

export function CodeBlock({ lines }: { lines: string[] }) {
  const [copied, setCopied] = useState(false);
  const text = lines.join("\n");

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard access can be denied; the snippet is still selectable by hand.
    }
  };

  return (
    <div className="code-block">
      <button
        type="button"
        className="code-block-copy"
        onClick={onCopy}
        aria-label="Copy command"
      >
        {copied ? "Copied" : "Copy"}
      </button>
      <pre>
        <code>
          {lines.map((line, i) => (
            <span className="code-line" key={i}>
              <span className="code-prompt">$</span> {line}
            </span>
          ))}
        </code>
      </pre>
    </div>
  );
}
