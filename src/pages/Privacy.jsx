import LegalPage from '../components/legal/LegalPage';

const Privacy = () => (
  <LegalPage kicker="Legal" title="Privacy Policy" updated="August 29, 2026">
    <h2>1. Overview</h2>
    <p>
      This Privacy Policy explains what information Khoj collects, why we collect it, and how it's used and
      protected. Khoj's whole premise is doing verification work transparently — that includes being
      straightforward about your data too.
    </p>

    <h2>2. Information we collect</h2>
    <p>When you use Khoj, we collect:</p>
    <ul>
      <li>
        <strong>Account details</strong> — your name, email, and optionally a phone number, when you sign up.
      </li>
      <li>
        <strong>Your question set and preferences</strong> — the questions you choose or write, any preferred
        answers or priorities, and your match threshold.
      </li>
      <li>
        <strong>Listing sources</strong> — the default sites we check, and any custom sources you add.
      </li>
      <li>
        <strong>Call data</strong> — recordings and transcripts of calls Khoj places on your behalf, along with
        any broker contact details collected during those calls.
      </li>
      <li>
        <strong>Usage data</strong> — basic analytics like pages visited and features used, to help us improve
        the product.
      </li>
    </ul>

    <h2>3. How we use your information</h2>
    <p>We use the information above to:</p>
    <ul>
      <li>Match listings against your questions and decide which ones qualify for a call.</li>
      <li>Place calls on your behalf and show you the results in your dashboard.</li>
      <li>Maintain your account and remember your preferences between visits.</li>
      <li>Improve Khoj's matching accuracy and call quality over time.</li>
      <li>Communicate with you about your account, call runs, or changes to our policies.</li>
    </ul>
    <p>We don't sell your personal information.</p>

    <h2>4. Call recording and transcripts</h2>
    <p>
      Every call Khoj places is recorded and transcribed so you can verify exactly what was said, and so we can
      confirm a call disclosed its AI nature. Recordings and transcripts are tied to your account and visible
      only to you. Where local law requires it, Khoj's opening disclosure is designed to satisfy call-recording
      consent requirements for the broker being called.
    </p>

    <h2>5. Third-party services</h2>
    <p>
      Khoj is built on Call-e's voice-calling infrastructure to place and manage calls. Listing data may be
      checked against third-party sites, including any custom source you add. We share only what's necessary
      with these services to operate the Service — we don't hand your full account data to listing sites or
      brokers.
    </p>

    <h2>6. Data retention</h2>
    <p>
      We keep your account information and call history for as long as your account is active, so your
      dashboard stays useful. If you delete your account, we delete your personal data and call recordings
      within a reasonable period, except where we're required to retain something for legal reasons.
    </p>

    <h2>7. Your rights and choices</h2>
    <p>You can, at any time:</p>
    <ul>
      <li>Edit your question set, sources, or profile from your dashboard.</li>
      <li>Download or request a copy of your call transcripts.</li>
      <li>Delete individual custom questions, sources, or your entire account.</li>
      <li>Ask us what personal data we hold about you.</li>
    </ul>

    <h2>8. Data security</h2>
    <p>
      We use standard safeguards — encryption in transit, access controls, and regular review of who can reach
      production data — to protect your information. No system is perfectly secure, so we also design Khoj to
      collect only what it actually needs.
    </p>

    <h2>9. Children's privacy</h2>
    <p>Khoj isn't intended for anyone under 18, and we don't knowingly collect data from minors.</p>

    <h2>10. Changes to this policy</h2>
    <p>
      If we make a material change to how we handle your data, we'll notify you before it takes effect. The
      "last updated" date at the top of this page always reflects the current version.
    </p>

    <h2>11. Contact us</h2>
    <p>
      For any privacy questions, or to exercise any of the rights above, reach out through the contact form on
      our homepage.
    </p>
  </LegalPage>
);

export default Privacy;
