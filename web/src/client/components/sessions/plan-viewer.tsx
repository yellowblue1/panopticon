import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface PlanViewerProps {
  content: string;
  slug: string;
}

export function PlanViewer({ content, slug }: PlanViewerProps) {
  return (
    <div className="plan-viewer">
      <div className="plan-header">
        <span className="plan-slug">{slug}</span>
      </div>
      <div className="plan-content">
        <Markdown remarkPlugins={[remarkGfm]}>{content}</Markdown>
      </div>
    </div>
  );
}
