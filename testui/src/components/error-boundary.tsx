import { Component, type ReactNode } from "react"

type Props = {
  children: ReactNode
  /** shadcn registry items this route needs, e.g. ["@bklit/line-chart"] */
  items?: string[]
  resetKey?: string
}

type State = { error: Error | null }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidUpdate(prev: Props) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null })
    }
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children

    const missingModule = /Failed to (fetch|resolve|load)|Cannot find module|does not provide an export/i.test(
      error.message,
    )
    const items = this.props.items ?? []

    return (
      <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-6">
        <h3 className="text-base font-semibold text-destructive">
          {missingModule ? "Component not installed yet" : "This demo threw an error"}
        </h3>

        {missingModule && items.length > 0 && (
          <>
            <p className="mt-2 text-sm text-muted-foreground">
              Pull it from the Bklit registry, then reload:
            </p>
            <pre className="mt-3 overflow-x-auto rounded-lg bg-background/70 p-3 text-xs">
              <code>{items.map((i) => `npx shadcn@latest add ${i}`).join("\n")}</code>
            </pre>
          </>
        )}

        <details className="mt-4">
          <summary className="cursor-pointer text-xs text-muted-foreground">
            Error detail
          </summary>
          <pre className="mt-2 overflow-x-auto whitespace-pre-wrap text-xs text-muted-foreground">
            {error.message}
            {"\n"}
            {error.stack?.split("\n").slice(0, 6).join("\n")}
          </pre>
        </details>
      </div>
    )
  }
}
