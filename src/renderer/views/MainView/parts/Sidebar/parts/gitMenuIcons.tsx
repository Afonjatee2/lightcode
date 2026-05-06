import {
  ArrowDownToLine,
  ArrowUpFromLine,
  ExternalLink,
  FileDiff,
  GitMerge,
  GitPullRequest,
  RefreshCw,
} from "lucide-react";
import type { GitMenuIcons } from "./useWorktreeActions";

export const gitMenuIcons: GitMenuIcons = {
  review: <FileDiff className="size-3.5" />,
  sync: <RefreshCw className="size-3.5" />,
  push: <ArrowUpFromLine className="size-3.5" />,
  pull: <ArrowDownToLine className="size-3.5" />,
  pullFromSource: <ArrowDownToLine className="size-3.5" />,
  merge: <GitMerge className="size-3.5" />,
  openPr: <ExternalLink className="size-3.5" />,
  createPr: <GitPullRequest className="size-3.5" />,
};
