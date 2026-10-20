import { Component, type ReactNode } from "react";

/** Shows what went wrong instead of a blank window, with a way to recover. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error("CyPals UI error:", error);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="crash" role="alert">
        <h1>Something went wrong</h1>
        <p>CyPals hit an error while drawing this screen. Your companions and chats are saved.</p>
        <pre>{String(this.state.error?.stack ?? this.state.error)}</pre>
        <button className="btn btn-primary" onClick={() => this.setState({ error: null })}>Try again</button>
      </div>
    );
  }
}
