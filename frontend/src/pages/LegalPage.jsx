import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Logo } from '../components/brand.jsx';

export default function LegalPage() {
  useEffect(() => {
    document.title = 'Terms and privacy · URAP';
    const id = window.location.hash.slice(1);
    if (id) document.getElementById(id)?.scrollIntoView();
  }, []);
  return (
    <div className="min-h-screen bg-white">
      <header className="border-b border-slate-200">
        <div className="page-container flex h-16 items-center justify-between">
          <Logo />
          <Link to="/signup" className="link text-sm">Create an account</Link>
        </div>
      </header>
      <main className="page-container max-w-3xl py-14 text-slate-700">
        <h1 className="text-4xl font-bold tracking-[-0.03em] text-ink">Terms and privacy</h1>
        <p className="mt-3 text-sm text-slate-500">These terms apply to this self-hosted URAP installation. Your organization's administrator may replace them with your own policies.</p>

        <section id="terms" className="mt-12 scroll-mt-6 space-y-4 leading-relaxed">
          <h2 className="text-2xl font-bold text-ink">Terms of Use</h2>
          <p>You may use this installation to design, run, and monitor automations for your organization. You are responsible for the workflows you build and for having permission to automate the systems and data they touch.</p>
          <p>Do not use the platform to access systems without authorization, to bypass security controls, or to process data you are not allowed to process. Administrators may disable accounts that break these rules.</p>
          <p>The software is provided as is. Test automations before relying on them for business-critical work.</p>
        </section>

        <section id="privacy" className="mt-12 scroll-mt-6 space-y-4 leading-relaxed">
          <h2 className="text-2xl font-bold text-ink">Privacy Notice</h2>
          <p>This installation stores your name, email address, organization name, a salted hash of your password (never the password itself), and a record of your sign-ins and actions for the audit log.</p>
          <p>Files, workflow definitions, and connection secrets are stored on the servers your organization runs. Connection secrets are encrypted. URAP does not send your data to the URAP authors or to third parties.</p>
          <p>To correct or delete your account, contact your URAP administrator.</p>
        </section>

        <Link to="/" className="btn btn-secondary btn-md mt-12">Back to the homepage</Link>
      </main>
    </div>
  );
}
