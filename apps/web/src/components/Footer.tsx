export function Footer() {
  return (
    <footer className="footer">
      <p>
        RepoPilot performs static analysis only. It does not execute code from
        audited repositories and does not perform a formal security audit.
        No investment advice.
      </p>
      <p>
        Payments in production run via the OKX Agent Payments Protocol (x402 /
        accepts[]). In dev, a mock adapter is used.
      </p>
    </footer>
  );
}
