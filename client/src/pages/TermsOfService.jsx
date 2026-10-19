import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faArrowLeft, faChevronRight } from '@fortawesome/free-solid-svg-icons'

import bg1 from '../assets/bg_1.jpg'
import bg2 from '../assets/bg_2.jpg'
import bg3 from '../assets/bg_3.jpg'


const sections = [
  { id: 'introduction', label: 'Introduction' },
  { id: 'acceptance', label: 'Acceptance of Terms' },
  { id: 'eligibility', label: 'Eligibility and Registration' },
  { id: 'use', label: 'Use of the DMC ECS' },
  { id: 'user-responsibilities', label: 'User Responsibilities' },
  { id: 'intellectual-property', label: 'Intellectual Property' },
  { id: 'third-party', label: 'Third-Party Services' },
  { id: 'suspension', label: 'Suspension and Termination' },
  { id: 'disclaimers', label: 'Disclaimers and Limitations' },
  { id: 'changes', label: 'Changes to These Terms' },
  { id: 'governing-law', label: 'Governing Law' },
  { id: 'contact', label: 'How to Contact Us' },
]


export default function TermsOfService() {
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
              <Link to="/" className="absolute left-4 top-6 z-30 inline-flex items-center gap-2 rounded-lg bg-green-700 px-4 py-2 text-sm font-semibold text-white opacity-100 shadow-sm transition-colors duration-200 hover:bg-green-800 lg:left-8">
                <FontAwesomeIcon icon={faArrowLeft}/>
                Back to Login
              </Link>

              {/* TERMS OF SERVICE BUTTON */}
              <Link to="/privacy-policy" className="absolute right-4 top-6 z-30 inline-flex items-center gap-1 rounded-lg bg-green-700 px-4 py-2 text-sm font-semibold text-white opacity-100 shadow-sm transition-colors duration-200 hover:bg-green-800 lg:right-8">
                Privacy Policy
                <FontAwesomeIcon icon={faChevronRight}/>
              </Link>

              {/* TITLE */}
              <div className="absolute inset-x-0 bottom-0 px-4 pb-8 pt-8 lg:px-8">
                <h1 className="text-4xl font-bold tracking-tight text-white sm:text-5xl">
                  Terms of Service
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
                  These Terms of Service (“Terms”) govern your access to and use of the
                  DMC Export Consolidation System (ECS). By accessing, registering for, or using DMC ECS,
                  you acknowledge that you have read, understood, and agree to be bound by these Terms.
                  These Terms establish the rules, conditions, and responsibilities that apply to your
                  use of the website, its features, services, and functionalities (collectively, our “Platforms”).
                </p>

                <p>
                  Please note that these Terms only pertain to your use of the DMC Export Consolidation System
                  and the information and/or functionalities offered on the Platform.
                </p>

                <p>
                  This Terms describes:
                </p>

                <ul className="pl-8 space-y-2">
                  <li>A. Acceptance of Terms</li>
                  <li>B. Eligibility and Account Registration</li>
                  <li>C. Use of the DMC Export Consolidation System</li>
                  <li>D. User Responsibilities</li>
                  <li>E. Intellectual Property</li>
                  <li>F. Third-Party Services</li>
                  <li>G. Suspension and Termination</li>
                  <li>H. Disclaimers and Limitations of Liability</li>
                  <li>I. Changes to These Terms</li>
                  <li>J. Governing Law</li>
                  <li>K. How to Contact Us</li>
                </ul>
              </div>
            </section>


            {/* ACCEPTANCE OF TERMS */}
            <section id="acceptance" className="mt-12 scroll-mt-8">
              <h2 className="text-2xl font-bold">
                A. ACCEPTANCE OF TERMS
              </h2>

              <div className="mt-4 space-y-4 leading-7">
                <p>
                  By accessing or using the DMC Export Consolidation System, you acknowledge that you have read,
                  understood, and agree to be bound by these Terms of Service (“Terms”),
                  as well as any applicable policies and guidelines referenced herein.
                  If you do not agree with these Terms, you should not access or use the DMC ECS.
                </p>

                <p>
                  These Terms apply to all users who access or use the DMC ECS, including
                  registered users and other authorized users. Your continued use of the Platform
                  following any updates to these Terms constitutes your acceptance of the revised Terms.
                </p>
              </div>
            </section>


            {/* ELIGIBILITY AND ACCOUNT REGISTRATION */}
            <section id="eligibility" className="mt-12 scroll-mt-8">
              <h2 className="text-2xl font-bold">
                B. ELIGIBILITY AND ACCOUNT REGISTRATION
              </h2>

              <div className="mt-4 space-y-4 leading-7">
                <p>
                  Access to certain features and functionalities of the DMC ECS may require you
                  to create and maintain an account. You agree to provide accurate, complete, and up-to-date
                  information during registration and to keep such information updated when necessary.
                </p>

                <p>
                  You are responsible for maintaining the confidentiality of your account credentials
                  and for all activities conducted through your account. You must not share your account
                  credentials with unauthorized individuals or allow others to access your account.
                </p>

                <p>
                  If you believe that your account has been accessed or used without authorization,
                  you should promptly notify the appropriate DMC ECS administrator.
                </p>

                <p>
                  We reserve the right to restrict, suspend, or terminate accounts that contain
                  inaccurate information, are used improperly, or otherwise violate these Terms.
                </p>
              </div>
            </section>


            {/* USE OF THE DMC ECS */}
            <section id="use" className="mt-12 scroll-mt-8">
              <h2 className="text-2xl font-bold">
                C. USE OF THE DMC ECS
              </h2>

              <div className="mt-4 space-y-4 leading-7">
                <p>
                  The DMC ECS is intended to provide users with access to its available services,
                  information, account features, transactions, and other authorized functionalities.
                </p>

                <p>
                  You agree to use the Platform only for lawful and legitimate purposes and in
                  accordance with these Terms. You must not use the Platform in any manner that may
                  interfere with its operation, compromise its security, or negatively affect other users.
                </p>

                <p>
                  You must not attempt to gain unauthorized access to any account, system, database,
                  or functionality of the DMC ECS. You must also not introduce malicious software,
                  conduct unauthorized automated activities, or otherwise attempt to disrupt or compromise the Platform.
                </p>
              </div>
            </section>


            {/* USER RESPONSIBILITIES */}
            <section id="user-responsibilities" className="mt-12 scroll-mt-8">
              <h2 className="text-2xl font-bold">
                D. USER RESPONSIBILITIES
              </h2>

              <div className="mt-4 space-y-4 leading-7">
                <p>
                  When using the DMC ECS, you are responsible for:
                </p>

                <ul className="pl-8 space-y-2">
                  <li>1. Providing accurate and complete information;</li>
                  <li>2. Maintaining the security of your account credentials;</li>
                  <li>3. Reviewing transaction and account information before submitting or confirming it;</li>
                  <li>4. Uploading only authentic and authorized documents;</li>
                  <li>5. Using the Platform in accordance with applicable laws and regulations;</li>
                  <li>6. Maintaining the confidentiality of information made available to you through the Platform; and</li>
                  <li>7. Promptly reporting suspected unauthorized access, security issues, or misuse of your account.</li>
                </ul>
              </div>
            </section>


            {/* INTELLECTUAL PROPERTY */}
            <section id="intellectual-property" className="mt-12 scroll-mt-8">
              <h2 className="text-2xl font-bold">
                E. INTELLECTUAL PROPERTY
              </h2>

              <div className="mt-4 space-y-4 leading-7">
                <p>
                  The DMC ECS and its content, including but not limited to its design, interface, text,
                  graphics, logos, trademarks, software, databases, and other materials, are owned by or licensed
                  to the organization operating the Platform and are protected by applicable intellectual property laws.
                </p>

                <p>
                  You may access and use the Platform only for its intended purposes. You may not reproduce, modify,
                  distribute, publish, transmit, sell, or otherwise exploit any portion of the Platform or its content
                  without prior authorization, except where permitted by applicable law.
                </p>

                <p>
                  Nothing in these Terms grants you ownership or any other rights to the Platform or its intellectual
                  property beyond the limited right to use the Platform in accordance with these Terms.
                </p>
              </div>
            </section>


            {/* THIRD-PARTY SERVICES */}
            <section id="third-party" className="mt-12 scroll-mt-8">
              <h2 className="text-2xl font-bold">
                F. THIRD-PARTY SERVICES
              </h2>

              <div className="mt-4 space-y-4 leading-7">
                <p>
                  The DMC ECS may use or provide access to third-party services, platforms,
                  applications, or content to support certain features or functionalities.
                </p>

                <p>
                  Third-party services may be governed by their own terms of service and privacy policies.
                  We are not responsible for the policies, availability, security, or practices of
                  third-party services that are outside our control.
                </p>

                <p>
                  Your use of any third-party service through or in connection with the DMC ECS may
                  therefore be subject to the applicable terms and policies of that third party.
                </p>
              </div>
            </section>


            {/* SUSPENSION AND TERMINATION */}
            <section id="suspension" className="mt-12 scroll-mt-8">
              <h2 className="text-2xl font-bold">
                G. SUSPENSION AND TERMINATION
              </h2>

              <div className="mt-4 space-y-4 leading-7">
                <p>
                  We reserve the right to suspend, restrict, or terminate your access to the
                  DMC ECS, in whole or in part, when reasonably necessary, including when you
                  violate these Terms, engage in unauthorized or fraudulent activities,
                  misuse the Platform, or pose a security or operational risk.
                </p>

                <p>
                  We may also restrict or terminate access when required by applicable law,
                  regulation, or legitimate operational requirements.
                </p>

                <p>
                  If your account or access is terminated, you must cease using the Platform
                  and must not attempt to regain access through unauthorized means.
                </p>

                <p>
                  Termination of access does not affect any rights, obligations, or responsibilities
                  that arose before termination or that are intended to survive termination under these Terms.
                </p>
              </div>
            </section>


            {/* DISCLAIMERS AND LIMITATIONS OF LIABILITY */}
            <section id="disclaimers" className="mt-12 scroll-mt-8">
              <h2 className="text-2xl font-bold">
                H. DISCLAIMERS AND LIMITATIONS OF LIABILITY
              </h2>

              <div className="mt-4 space-y-4 leading-7">
                <p>
                  The DMC ECS is provided for its intended business and operational purposes.
                  While we make reasonable efforts to maintain the accuracy, security, availability,
                  and functionality of the Platform, we do not guarantee that the Platform will always
                  be available, uninterrupted, error-free, or free from security vulnerabilities.
                </p>

                <p>
                  The Platform may occasionally be unavailable due to maintenance, technical issues,
                  system updates, connectivity problems, or circumstances beyond our reasonable control.
                </p>

                <p>
                  To the extent permitted by applicable law, we shall not be responsible for losses
                  or damages arising from unauthorized access caused by circumstances beyond our reasonable
                  control, interruptions to the Platform, or a user's failure to comply with these Terms.
                </p>

                <p>
                  Nothing in these Terms is intended to exclude or limit any liability
                  that cannot legally be excluded or limited under applicable law.
                </p>
              </div>
            </section>


            {/* CHANGES TO THESE TERMS */}
            <section id="changes" className="mt-12 scroll-mt-8">
              <h2 className="text-2xl font-bold">
                I. CHANGES TO THESE TERMS
              </h2>

              <div className="mt-4 space-y-4 leading-7">
                <p>
                  We may update or modify these Terms from time to time to reflect changes to the
                  DMC ECS, our services, operational practices, or applicable laws and regulations.
                </p>

                <p>
                  When changes are made, the updated Terms will be posted on this page together with
                  a revised “Last Updated” date. Your continued use of the DMC ECS after the updated
                  Terms become effective constitutes your acknowledgment and acceptance of the changes.
                </p>

                <p>
                  We encourage you to review these Terms periodically to remain informed
                  about the conditions governing your use of the Platform.
                </p>
              </div>
            </section>


            {/* GOVERNING LAW */}
            <section id="governing-law" className="mt-12 scroll-mt-8">
              <h2 className="text-2xl font-bold">
                J. GOVERNING LAW
              </h2>

              <div className="mt-4 space-y-4 leading-7">
                <p>
                  These Terms shall be governed by and interpreted in accordance with the applicable
                  laws of the Republic of the Philippines, without regard to its conflict-of-law principles.
                </p>

                <p>
                  Any disputes arising from or relating to your use of the DMC ECS or these Terms
                  shall be subject to the applicable laws, rules, and regulations of the Republic of
                  the Philippines and the appropriate courts or authorities with jurisdiction.
                </p>
              </div>
            </section>


            {/* HOW TO CONTACT US */}
            <section id="contact" className="mt-12 scroll-mt-8">
              <h2 className="text-2xl font-bold">
                L. HOW TO CONTACT US
              </h2>

              <div className="mt-4 space-y-4 leading-7">
                <p>
                  If you have questions, concerns, or requests regarding these Terms of Service
                  or your use of the DMC ECS, you may contact the organization or authorized
                  administrator through the official contact information provided on the Platform.
                </p>

                <p>
                  We encourage users to contact us promptly regarding any concerns involving
                  their account, transactions, unauthorized access, or suspected misuse of the DMC ECS.
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