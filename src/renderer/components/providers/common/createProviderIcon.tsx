import type { StatusTone } from "../statusTone";
import { StatusIcon } from "../StatusIcon";

interface CreateProviderIconOptions {
  cssPrefix: string;
  path: string;
  viewBox: string;
  fillRule?: "evenodd" | "nonzero";
  secondaryPath?: string;
  defaultTone?: StatusTone;
}

interface ProviderIconProps {
  tone?: StatusTone;
  className?: string;
  title?: string;
}

export function createProviderIcon(opts: CreateProviderIconOptions) {
  const defaultTone = opts.defaultTone ?? "inactive";
  return function ProviderIcon(props: ProviderIconProps) {
    return (
      <StatusIcon
        cssPrefix={opts.cssPrefix}
        path={opts.path}
        tone={props.tone ?? defaultTone}
        viewBox={opts.viewBox}
        className={props.className}
        {...(opts.fillRule ? { fillRule: opts.fillRule } : {})}
        {...(opts.secondaryPath ? { secondaryPath: opts.secondaryPath } : {})}
        {...(props.title ? { title: props.title } : {})}
      />
    );
  };
}
