import LegalPage from '../components/legal/LegalPage';

const Terms = () => (
  <LegalPage kicker="Legal" title="Terms of Service" updated="August 29, 2026">
    <h2>1. Agreement to these terms</h2>
    <p>
      These Terms of Service ("Terms") govern your access to and use of Khoj, including our website, dashboard,
      and the voice-calling service we provide (together, the "Service"). By creating an account or using Khoj,
      you agree to these Terms. If you don't agree, please don't use the Service.
    </p>

    <h2>2. What Khoj does</h2>
    <p>
      Khoj is an AI voice agent that calls brokers and landlords on your behalf to verify details about rental
      or purchase listings — availability, price, deposit, and whatever else you've told us matters to you. We
      check listings against your question set before we ever place a call, and only dial when a listing already
      looks like a match.
    </p>
    <p>
      Every call opens by disclosing that it's an AI calling on your behalf. Khoj does not, and will not, pretend
      to be a human caller.
    </p>

    <h2>3. Your account</h2>
    <p>
      You need an account to use Khoj. You're responsible for keeping your login credentials secure and for
      everything that happens under your account. Let us know right away if you think someone else has access
      to it.
    </p>
    <p>You must be at least 18 years old to create an account.</p>

    <h2>4. Acceptable use</h2>
    <p>You agree not to use Khoj to:</p>
    <ul>
      <li>Call numbers you don't have a legitimate reason to contact, or numbers on a do-not-call registry.</li>
      <li>Harass, threaten, or mislead the brokers, landlords, or agents Khoj calls.</li>
      <li>Scrape, resell, or redistribute call transcripts, recordings, or listing data at scale.</li>
      <li>Attempt to reverse-engineer, overload, or disrupt the Service.</li>
    </ul>

    <h2>5. Calls made on your behalf</h2>
    <p>
      When you start a call run, you authorize Khoj to place phone calls to the numbers associated with matching
      listings, using the question set and preferences you've configured. Calls are placed within reasonable
      hours and disclose their AI nature up front. Call recordings and transcripts are made available to you in
      your dashboard so you can verify what was actually said.
    </p>
    <p>
      Khoj is built on Call-e's voice-calling infrastructure. Your use of the Service is also subject to any
      applicable telecom regulations in your region, and you're responsible for using the calling feature
      lawfully.
    </p>

    <h2>6. Plans and billing</h2>
    <p>
      Khoj offers a free trial and paid plans with higher daily call limits and more custom questions. Paid plans
      are billed on the cycle shown at checkout. You can cancel at any time; your plan remains active until the
      end of the billing period you've already paid for.
    </p>

    <h2>7. Listing sources you add</h2>
    <p>
      If you add your own listing sources, you confirm you have the right to have Khoj check and reference that
      site, and you take responsibility for the accuracy of any listings pulled from a source you've added
      yourself.
    </p>

    <h2>8. Intellectual property</h2>
    <p>
      Khoj and its logo, design, and underlying technology belong to us. You retain ownership of the questions,
      preferences, and any notes you add to your account.
    </p>

    <h2>9. Disclaimers</h2>
    <p>
      Khoj reports back what a broker said on a call — we don't independently verify legal title, ownership, or
      the physical condition of a property. A "verified" call means the broker answered your questions; it
      doesn't guarantee the listing is free of every risk. Always do your own diligence, including an in-person
      visit, before committing to any home.
    </p>

    <h2>10. Limitation of liability</h2>
    <p>
      To the extent permitted by law, Khoj isn't liable for indirect, incidental, or consequential damages
      arising from your use of the Service, including decisions made based on information a broker provided
      during a call.
    </p>

    <h2>11. Termination</h2>
    <p>
      You may stop using Khoj and delete your account at any time. We may suspend or terminate accounts that
      violate these Terms, particularly the acceptable-use section above.
    </p>

    <h2>12. Changes to these terms</h2>
    <p>
      We may update these Terms as Khoj evolves. If we make a material change, we'll let you know before it
      takes effect. Continuing to use the Service after a change means you accept the updated Terms.
    </p>

    <h2>13. Contact us</h2>
    <p>
      Questions about these Terms? Reach out through the contact form on our homepage and we'll get back to you.
    </p>
  </LegalPage>
);

export default Terms;
