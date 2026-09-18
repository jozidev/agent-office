import { Component, type ReactNode } from "react";

/** A model that fails to load renders nothing instead of taking the scene down. */
export class ModelBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override componentDidCatch(err: unknown) {
    console.warn("model failed to load", err);
  }
  override render() {
    return this.state.failed ? null : this.props.children;
  }
}
