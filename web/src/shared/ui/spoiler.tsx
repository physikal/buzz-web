import {
  Children,
  createContext,
  isValidElement,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
  useCallback,
  useContext,
  useRef,
  useState,
} from "react";
import { SpoilerParticles } from "./spoiler-particles";

export const SpoilerHiddenContext = createContext(false);

export function Spoiler({
  block = false,
  children,
  interactive = true,
}: {
  block?: boolean;
  children?: ReactNode;
  interactive?: boolean;
}) {
  const [revealed, setRevealed] = useState(false);
  const contentRef = useRef<HTMLElement | null>(null);
  const toggle = useCallback(() => setRevealed((value) => !value), []);
  const setContentElement = useCallback((node: HTMLElement | null) => {
    contentRef.current = node;
  }, []);
  const isBlock = block || hasBlockMedia(Children.toArray(children));
  const className = `buzz-spoiler${isBlock ? " buzz-spoiler--block" : ""}${interactive ? "" : " buzz-spoiler--inert"}`;
  const Element = isBlock ? "div" : "span";
  const ContentElement = isBlock ? "div" : "span";

  const revealProps = interactive
    ? {
        "aria-label": revealed ? "Hide spoiler" : "Reveal spoiler",
        "aria-pressed": revealed,
        onClick: (event: MouseEvent<HTMLElement>) => {
          if (revealed && isBlock && event.target !== event.currentTarget)
            return;
          toggle();
        },
        onClickCapture: (event: MouseEvent<HTMLElement>) => {
          if (revealed) return;
          event.preventDefault();
          event.stopPropagation();
          toggle();
        },
        onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          toggle();
        },
        onPointerDownCapture: (event: PointerEvent<HTMLElement>) => {
          if (!revealed) event.stopPropagation();
        },
        role: "button",
        tabIndex: 0,
      }
    : {};

  return (
    <Element
      {...revealProps}
      className={className}
      data-revealed={revealed ? "true" : "false"}
      data-spoiler=""
    >
      <SpoilerParticles active={!revealed} contentRef={contentRef} />
      <ContentElement className="buzz-spoiler__content" ref={setContentElement}>
        <SpoilerHiddenContext.Provider value={!revealed}>
          {children}
        </SpoilerHiddenContext.Provider>
      </ContentElement>
    </Element>
  );
}

function hasBlockMedia(children: ReactNode[]) {
  const visit = (child: ReactNode): boolean => {
    if (!isValidElement(child)) return false;
    const props = child.props as {
      children?: ReactNode;
      node?: { tagName?: unknown };
      [key: string]: unknown;
    };
    if (
      props["data-block-media"] !== undefined ||
      props.node?.tagName === "img"
    )
      return true;
    return Children.toArray(props.children).some(visit);
  };
  return children.some(visit);
}

export function SpoilerAwareAnchor({
  children,
  href,
  ...props
}: React.ComponentPropsWithoutRef<"a">) {
  const hidden = useContext(SpoilerHiddenContext);
  const external = href?.startsWith("http://") || href?.startsWith("https://");
  return (
    <a
      {...props}
      aria-disabled={hidden || undefined}
      href={hidden ? undefined : href}
      rel={external ? "noreferrer" : props.rel}
      role={hidden ? "link" : props.role}
      target={external ? "_blank" : props.target}
    >
      {children}
    </a>
  );
}

export function spoilerComponent(interactive = true) {
  return ({
    children,
    ...props
  }: {
    "data-block-spoiler"?: string;
    children?: ReactNode;
  }) => (
    <Spoiler
      block={props["data-block-spoiler"] !== undefined}
      interactive={interactive}
    >
      {children}
    </Spoiler>
  );
}
