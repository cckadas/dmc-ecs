import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faArrowLeft, faChevronRight } from '@fortawesome/free-solid-svg-icons'

import bg1 from '../assets/bg_1.jpg'
import bg2 from '../assets/bg_2.jpg'
import bg3 from '../assets/bg_3.jpg'


const sections = [
  { id: 'introduction', label: 'Introduction' },
  { id: 'information-we-collect', label: 'Information We Collect' },
  { id: 'how-we-use-information', label: 'How We Use the Information' },
  { id: 'how-we-share-information', label: 'How We Share the Information' },
  { id: 'third-party-services', label: 'Third-Party Services' },
  { id: 'protection-and-storage', label: 'Protection and Storage' },
  { id: 'choices-and-rights', label: 'Your Choices and Rights' },
  { id: 'contact', label: 'How to Contact Us' },
  { id: 'changes', label: 'Changes to Privacy Policy' },
]

export default function PrivacyPolicy() {
  const [currentImage, setCurrentImage] = useState(0)
    const images = [bg1, bg2, bg3]

  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentImage((prev) => (prev + 1) % images.length)
    }, 5000)

    return () => clearInterval(interval)
  }, [])

  return (
    <div className="min-h-screen bg-white">
      <div className="mx-auto w-full">

        {/* HERO IMAGE */}
        <div className="relative isolate h-[280px] w-full overflow-hidden sm:h-[340px] lg:h-[400px]">

          {/* SLIDESHOW — BEHIND EVERYTHING */}
          {images.map((image, index) => (
            <img
              key={image}
              src={image}
              alt=""
              className={`absolute inset-0 z-0 h-full w-full object-cover object-center transition-opacity duration-[1500ms] ease-in-out ${
                index === currentImage ? 'opacity-100' : 'opacity-0'
              }`}
            />
          ))}

          {/* GRADIENT */}
          <div className="pointer-events-none absolute inset-0 z-10 bg-gradient-to-t from-black/50 to-transparent" />

          {/* CONTENT */}
          <div className="absolute inset-0 z-20">
            <div className="relative mx-auto h-full w-full max-w-[1200px]">

              {/* BACK BUTTON */}
              <Link to="/"  className="absolute left-4 top-6 z-30 inline-flex items-center gap-2 rounded-lg bg-green-700 px-4 py-2 text-sm font-semibold text-white opacity-100 shadow-sm transition-colors duration-200 hover:bg-green-800 lg:left-8">
                <FontAwesomeIcon icon={faArrowLeft}/>
                Back to Login
              </Link>

              {/* TERMS OF SERVICE BUTTON */}
              <Link to="/terms-of-service" className="absolute right-4 top-6 z-30 inline-flex items-center gap-1 rounded-lg bg-green-700 px-4 py-2 text-sm font-semibold text-white opacity-100 shadow-sm transition-colors duration-200 hover:bg-green-800 lg:right-8">
                Terms of Service
                <FontAwesomeIcon icon={faChevronRight}/>
              </Link>

              {/* TITLE */}
              <div className="absolute inset-x-0 bottom-0 px-4 pb-8 pt-8 lg:px-8">
                <h1 className="text-4xl font-bold tracking-tight text-white sm:text-5xl">
                  Privacy Policy
                </h1>

                <p className="mt-2 text-md font-medium text-white">
                  LAST UPDATE: October 15, 2026
                </p>
              </div>

            </div>
          </div>
        </div>

        {/* CONTENT + TABLE OF CONTENTS */}
        <div className="mx-auto grid w-full max-w-[1200px] grid-cols-1 gap-12 px-4 py-12 lg:grid-cols-[minmax(0,1fr)_260px] lg:px-8">

          {/* RIGHT — TABLE OF CONTENTS */}
          <aside className="order-first lg:order-last lg:sticky lg:top-8 lg:self-start">
            <div className="border-l border-gray-200 pl-6">
              <h3 className="text-sm font-bold">
                Table of Contents
              </h3>

              <nav className="mt-4">
                <ul className="space-y-1">
                  {sections.map((section) => (
                    <li key={section.id}>
                      <a href={`#${section.id}`} className="block rounded-md px-3 py-2 text-sm text-gray-600 transition-colors hover:bg-green-100">
                        {section.label}
                      </a>
                    </li>
                  ))}
                </ul>
              </nav>
            </div>
          </aside>

          {/* LEFT — POLICY CONTENT */}
          <main className="order-last min-w-0 lg:order-first">

            {/* INTRODUCTION */}
            <section id="introduction" className="scroll-mt-8">
              <h2 className="text-2xl font-bold">
                Introduction
              </h2>

              <div className="mt-4 space-y-4 leading-7">
                <p>
                  This is the Privacy Policy (“Policy”) for the DMC Export Consolidation System.
                  We are committed to complying with the Philippine Data Privacy Act
                  of 2012 (DPA). This Privacy Policy describes how we may collect,
                  use, share, or otherwise process personal information, particularly
                  in association with our system development practices and the
                  operation of our website and email correspondence (collectively, our “Platforms”).
                </p>

                <p>
                  Please note that this Policy only pertains to our Platforms and
                  the information and/or functionalities offered on them.
                </p>

                <p>
                  This Policy describes:
                </p>

                <ul className="pl-8 space-y-2">
                  <li>A. The Types of Information We Collect</li>
                  <li>B. How We Use the Information We Collect</li>
                  <li>C. How We May Share the Information We Collect</li>
                  <li>D. Third-Party Services and Content</li>
                  <li>E. Protection and Storage of the Information We Collect</li>
                  <li>F. Your Choices and Rights</li>
                  <li>G. How to Contact Us</li>
                </ul>
              </div>
            </section>


            {/* INFORMATION WE COLLECT */}
            <section id="information-we-collect" className="mt-12 scroll-mt-8">
              <h2 className="text-2xl font-bold">
                A. THE TYPES OF INFORMATION WE COLLECT
              </h2>

              <div className="mt-4 space-y-4 leading-7">
                <p>
                  We collect your personal information when you provide it to us.
                  “Personal information” is any information that can be used to
                  identify you or that we can link to you. We may automatically
                  collect certain information when you use, access,
                  or interact with our Platforms. 
                </p>

                <p>
                  Please note that this Policy only pertains to our Platforms and
                  the information and/or functionalities offered on them.
                </p>

                <p>
                  This Policy describes:
                </p>

                <ul className="space-y-2">
                  <li>
                    <span className="font-semibold">
                      1. Information you provide to us.
                    </span>{' '}
                    We collect information that you provide to us, including when you
                    communicate with us via email or other channels; when you respond to
                    our communications or requests for information; when you provide file
                    or image access. The information you provide may include your name,
                    contact information, email address, address, and other information
                    about yourself. Some of our Platforms may require that you enter a password
                    or other information in order to access certain features, and we collect
                    such credentials when you enter them.
                  </li>

                  <li>
                    <span className="font-semibold">
                      2. Information we collect from other sources.
                    </span>{' '}
                    We may receive information about you from other sources, including third
                    parties that help us: update, expand, and analyze our records; identify
                    new customers; or prevent or detect fraud. The information we may receive
                    is governed by the privacy settings and policies.
                  </li>
                </ul>
              </div>
            </section>


            {/* HOW WE USE INFORMATION */}
            <section id="how-we-use-information" className="mt-12 scroll-mt-8">
              <h2 className="text-2xl font-bold">
                B. HOW WE USE THE INFORMATION WE COLLECT
              </h2>

              <div className="mt-4 space-y-4 leading-7">
                <ul className="space-y-2">
                  <li>1. To aggregate information about you from multiple sources;</li>
                  <li>2. To respond to your inquiries;</li>
                  <li>3. To provide you with inquiries that you request;</li>
                  <li>4. To process payment for any reservations that you made;</li>
                  <li>5. To operate, troubleshoot, and improve the Platforms;</li>
                  <li>6. To send you notifications, updates, and other information that may help you;</li>
                  <li>7. To maintain our list of users;</li>
                  <li>8. For system’s report purposes, including data analysis; report generation; detecting, preventing, and responding to actual or potential fraud, illegal activities, or intellectual property infringement;</li>
                  <li>9. As we believe reasonably necessary or appropriate to: comply with our legal obligations respond to legal process or requests for information issued by the government authorities or other third parties; or protector your, our, or other’s rights;</li>
                  <li>10. In another way that we indicate when we collect it; and</li>
                  <li>11. Any other manner that you give us permission to do.</li>
                </ul>
              </div>
            </section>


            {/* HOW WE SHARE INFORMATION */}
            <section id="how-we-share-information" className="mt-12 scroll-mt-8">
              <h2 className="text-2xl font-bold">
                C. HOW WE MAY SHARE THE INFORMATION WE COLLECT
              </h2>

              <div className="mt-4 space-y-4 leading-7">
                <ul className="space-y-2">
                  <li>
                    1. We may share your information in a number of ways and circumstances.
                    We may share your information in any way that we indicate at the time
                    we collect it. We may also share the information we collect in other ways
                    if you give us consent to those other ways.
                  </li>
                  
                  <li>
                    2. We do not sell, rent, or otherwise share information that reasonably
                    identifies you with unaffiliated entities for their independent use except as
                    expressly described in this Policy or with your prior permission. We may share
                    information that does not reasonably identify you as permitted by applicable law.
                  </li>
                  
                  <li>
                    3. We may also disclose information we collect:
                    <div className="mt-4 space-y-4 leading-7">
                      <ul className="pl-8 space-y-2">
                        <li>
                          a. To our third-party service providers that perform services
                          on our behalf, such as web-hosting companies, mailing vendors,
                          analytics providers, and information technology providers.
                        </li>
                        
                        <li>
                          b. To law enforcement, other government authorities, or third parties
                          (within or outside the jurisdiction in which you reside) as may be permitted
                          or required by the laws of any jurisdiction that may apply to us;
                          as provided for under contract; or as we deem reasonably necessary
                          to provide you services. In these circumstances, we take reasonable efforts
                          to notify you before we disclose information that may reasonably identify you,
                          unless prior notice is prohibited by applicable law or is not possible or
                          reasonable in the circumstances.
                        </li>
                      </ul>
                    </div>
                  </li>
                  
                  <li>
                    4. We may share anonymous, de-identified, or aggregate information that cannot
                    reasonably identify you with others for any purpose, as permitted by applicable law.
                  </li>
                  
                  <li>
                    5. Grounds for using or processing your personal information. We rely on the following legal grounds to process your personal information, namely:
                    <div className="mt-4 space-y-4 leading-7">
                      <ul className="pl-8 space-y-2">
                        <li>
                          <span className="font-semibold">
                            a. Consent.
                          </span>{' '}
                          By using our Platforms, you consent to our use of your personal
                          information as described in this Policy. If you object to such use,
                          please cease all uses of the Platforms. We may use precise location
                          information as described in this Policy. You may be able to disable the
                          sharing of location in your browser or mobile application settings.
                        </li>

                        <li>
                          <span className="font-semibold">
                            b. Legitimate interests.
                          </span>{' '}
                            We may use your personal information for our legitimate interest to
                            improve our system and the content on our Platforms. Consistent with
                            our legitimate interests and any choices that we offer or consents that
                            may be required under applicable laws, we may use technical information
                            as described in this Policy and use personal information for our administrative purposes. 
                        </li>
                      </ul>
                    </div>
                  </li>
                
                </ul>
              </div>
            </section>


            {/* THIRD-PARTY SERVICES AND CONTENT */}
            <section id="third-party-services" className="mt-12 scroll-mt-8">
              <h2 className="text-2xl font-bold">
                D. THIRD-PARTY SERVICES AND CONTENT
              </h2>

              <div className="mt-4 space-y-4 leading-7">
                <p>
                  Our Platforms may include integrated content or links to content provided by third parties.
                  This Policy does not address the privacy, security, or other practices of the third parties
                  that provide such content. We may engage these parties that support the operation of our Platforms,
                  such as email providers. These third parties may use technologies to track your online activities
                  over time and across different websites and online platforms. Please see above how we use Cookies.
                </p>
              </div>
            </section>


            {/* PROTECTION AND STORAGE */}
            <section id="protection-and-storage" className="mt-12 scroll-mt-8">
              <h2 className="text-2xl font-bold">
                E. PROTECTION AND STORAGE OF THE INFORMATION WE COLLECT
              </h2>

              <div className="mt-4 space-y-4 leading-7">
                <ul className="space-y-2">
                  <li>
                    <span className="font-semibold">
                      1. Legal Precautions.
                    </span>{' '}
                    We take reasonable precautions to comply with applicable legal requirements
                    and safeguard the information that we collect. However, no information system
                    can be 100% secure. So, we cannot guarantee the absolute security of your information.
                    Moreover, we are not responsible for the security of information you transmit
                    to us over networks that we do not control, including the Internet, telephone
                    and wireless networks, or even the information technology infrastructure of any of our vendors.
                  </li>

                  <li>
                    <span className="font-semibold">
                      2. Location.
                    </span>{' '}
                      The system is created and managed by the people of BAJ Pharmaceuticals
                      from 26 Timog Avenue, Diliman, Quezon City. 
                  </li>
                  
                  <li>
                    <span className="font-semibold">
                      3. Children.
                    </span>{' '}
                      We do not knowingly collect information from children under the age of thirteen (13),
                      and our Platforms are not targeted to children under the age of thirteen (13).
                  </li>
                </ul>
              </div>
            </section>


            {/* CHOICES ADN RIGHTS */}
            <section id="choices-and-rights" className="mt-12 scroll-mt-8">
              <h2 className="text-2xl font-bold">
                F. YOUR CHOICES AND RIGHTS
              </h2>

              <div className="mt-4 space-y-4 leading-7">
                <ul className="space-y-2">
                  <li>
                    1. If you no longer wish to receive communications from us, you can let us know by
                    sending us an email via our contact information provided on the footer of this website.
                    Please note that if you opt-out of communications, we may still contact you
                    such as thoseabout ongoing relations or administrative messages.
                  </li>
                  
                  <li>
                    2. Subject to local law, you may have certain rights regarding information that we have
                    collected and that is related to you. We encourage you to contact us to update
                    or correct your information if it changes or if you believe that any information
                    that we have collected about you is inaccurate. You can also ask us to see what
                    personal information we hold about you, to erase your personal information
                    and you may tell us if you object to our use of your personal information.
                    In some jurisdictions, you exercise the rights you may have,
                    send us an email via our contact information.
                  </li>
                </ul>
              </div>
            </section>


            {/* HOW TO CONTACT US*/}
            <section id="contact" className="mt-12 scroll-mt-8">
              <h2 className="text-2xl font-bold">
                G. HOW TO CONTACT US
              </h2>

              <div className="mt-4 space-y-4 leading-7">
                <p>
                  We welcome your inquiries and comments. But please note that if you are not a
                  verified user, we may not be able to treat the information you send us as
                  confidential or privileged. If you wish to contact us regarding our system,
                  please contact us directly at contact email address or by mail at{' '}
                  <span className="font-semibold italic text-[var(--color-primary)]">
                    sales@bajpharma.com
                  </span>
                </p>
              </div>
            </section>


            {/* CHANGES TO THIS PRIVACY POLICY */}
            <section id="changes" className="mt-12 scroll-mt-8">
              <h2 className="text-2xl font-bold">
                H. CHANGES TO THIS PRIVACY POLICY
              </h2>

              <div className="mt-4 space-y-4 leading-7">
                <p>
                  We may update this Policy from time to time. The effective date of the current Policy
                  is noted at the top of this page. We encourage you to periodically review this page
                </p>
              </div>
            </section>
          </main>
        </div>


        {/* FOOTER */}
        <div className="py-8 text-center">
          <Link to="/" className="inline-block rounded-lg bg-green-700 px-8 py-3 font-semibold text-white transition hover:bg-green-800">
            Back to Log In
          </Link>
        </div>

      </div>
    </div>
  )
}