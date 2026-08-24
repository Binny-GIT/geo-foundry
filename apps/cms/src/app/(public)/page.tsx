import { GeoLogo } from "../../components/branding/GeoLogo"
import {
  CheckCircleIcon,
  GlobeIcon,
  LayersIcon,
  LockIcon,
  PackageIcon,
  PencilIcon,
  SearchIcon,
  SendIcon,
  ShieldCheckIcon,
  UsersIcon,
} from "../../components/icons"

import styles from "./page.module.css"

export const metadata = {
  description: "Geo Foundry content management workspace",
  title: "Geo Foundry",
}

const OUTCOMES = [
  {
    Icon: PencilIcon,
    copy: "Stage briefs, editions, and site adaptations with version history that makes every change traceable.",
    title: "Governed production",
  },
  {
    Icon: ShieldCheckIcon,
    copy: "Rules, semantic checks, and AI evidence give reviewers a decision-ready quality gate before release.",
    title: "Evidence-backed quality",
  },
  {
    Icon: PackageIcon,
    copy: "Verified manifests and immutable artifacts make delivery predictable, auditable, and reversible.",
    title: "Reliable delivery",
  },
] as const

const PROOF = [
  { label: "workflow states", note: "draft to archived", value: "7" },
  { label: "quality layers", note: "rules, semantic, AI", value: "3" },
  { label: "site themes", note: "Next.js and Express", value: "2" },
  { label: "rollback", note: "verified releases only", value: "1-click" },
] as const

const WORKFLOW = [
  { Icon: PencilIcon, copy: "Write and adapt the edition.", role: "Editor", title: "Draft" },
  { Icon: SearchIcon, copy: "Inspect substance and intent.", role: "Reviewer", title: "Review" },
  {
    Icon: ShieldCheckIcon,
    copy: "Require current, passing evidence.",
    role: "Evidence",
    title: "Quality gate",
  },
  { Icon: SendIcon, copy: "Release an immutable version.", role: "Publisher", title: "Publish" },
] as const

const TEAM = [
  { Icon: PencilIcon, label: "Editor" },
  { Icon: SearchIcon, label: "Reviewer" },
  { Icon: SendIcon, label: "Publisher" },
  { Icon: UsersIcon, label: "Tenant admin" },
] as const

const RootPage = () => (
  <main className={styles["page"]}>
    <header className={`${styles["shell"]} ${styles["header"]}`}>
      <GeoLogo />
      <a className={styles["signIn"]} href="/admin">
        Sign in <span aria-hidden="true">→</span>
      </a>
    </header>

    <section className={`${styles["shell"]} ${styles["hero"]}`}>
      <div>
        <p className={styles["eyebrow"]}>Governed content operations</p>
        <h1 className={styles["display"]}>Content operations workspace</h1>
        <p className={styles["lead"]}>
          Plan, review, prove, and release multi-site content without losing the audit trail, tenant
          boundary, or serving reliability that production work needs.
        </p>
        <a className={styles["primaryAction"]} href="/admin">
          Open administration <span aria-hidden="true">→</span>
        </a>
        <div className={styles["assurances"]}>
          <span className={styles["assurance"]}>
            <LockIcon size={16} strokeWidth={1.9} /> Multi-tenant isolation
          </span>
          <span className={styles["assurance"]}>
            <PackageIcon size={16} strokeWidth={1.9} /> Immutable, verified releases
          </span>
        </div>
      </div>

      <aside aria-label="Geo Foundry release workflow" className={styles["productPanel"]}>
        <p className={styles["panelKicker"]}>Release workspace</p>
        <h2 className={styles["panelHeading"]}>A controlled path from edition to serving.</h2>
        <ol className={styles["panelSteps"]}>
          <li className={styles["panelStep"]}>
            <PencilIcon size={18} strokeWidth={1.8} /> Draft <span>versioned</span>
          </li>
          <li className={styles["panelStep"]}>
            <ShieldCheckIcon size={18} strokeWidth={1.8} /> Quality evidence <span>current</span>
          </li>
          <li className={styles["panelStep"]}>
            <SendIcon size={18} strokeWidth={1.8} /> Publish <span>role-gated</span>
          </li>
        </ol>
        <div className={styles["release"]}>
          <CheckCircleIcon size={20} strokeWidth={1.9} />
          <span className={styles["releaseLabel"]}>Serving artifact</span>
          <code className={styles["releaseId"]}>release/verified/current</code>
        </div>
      </aside>
    </section>

    <section aria-label="Product proof" className={`${styles["shell"]} ${styles["proofBand"]}`}>
      {PROOF.map((item) => (
        <div className={styles["proofItem"]} key={item.label}>
          <strong className={styles["proofValue"]}>{item.value}</strong>
          <span className={styles["proofLabel"]}>{item.label}</span>
          <span className={styles["proofNote"]}>{item.note}</span>
        </div>
      ))}
    </section>

    <section className={`${styles["shell"]} ${styles["section"]}`}>
      <div className={styles["sectionHeader"]}>
        <p className={styles["eyebrow"]}>Built for production</p>
        <h2 className={styles["sectionTitle"]}>Content velocity without governance debt.</h2>
        <p className={styles["sectionLead"]}>
          Geo Foundry separates the work that creates content from the evidence and release controls
          that make it safe to serve.
        </p>
      </div>
      <div className={styles["outcomes"]}>
        {OUTCOMES.map((outcome) => (
          <article className={styles["outcome"]} key={outcome.title}>
            <span className={styles["outcomeIcon"]}>
              <outcome.Icon size={22} strokeWidth={1.75} />
            </span>
            <h3 className={styles["outcomeTitle"]}>{outcome.title}</h3>
            <p className={styles["outcomeCopy"]}>{outcome.copy}</p>
          </article>
        ))}
      </div>
    </section>

    <section className={styles["workflow"]}>
      <div className={`${styles["shell"]} ${styles["section"]}`}>
        <div className={styles["sectionHeader"]}>
          <p className={styles["eyebrow"]}>Workflow</p>
          <h2 className={styles["sectionTitle"]}>Every handoff has a clear owner.</h2>
          <p className={styles["sectionLead"]}>
            The path stays legible to every role, while the state machine and quality gate keep
            unsupported changes out of production.
          </p>
        </div>
        <ol aria-label="Content workflow" className={styles["workflowList"]}>
          {WORKFLOW.map((stage) => (
            <li className={styles["workflowStep"]} key={stage.title}>
              <span className={styles["workflowIcon"]}>
                <stage.Icon size={20} strokeWidth={1.8} />
              </span>
              <span aria-hidden="true" className={styles["workflowNumber"]}>
                {WORKFLOW.indexOf(stage) + 1}
              </span>
              <span className={styles["workflowRole"]}>{stage.role}</span>
              <h3 className={styles["workflowTitle"]}>{stage.title}</h3>
              <p className={styles["workflowCopy"]}>{stage.copy}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>

    <section className={`${styles["shell"]} ${styles["section"]}`}>
      <div className={styles["sectionHeader"]}>
        <p className={styles["eyebrow"]}>Separated duties</p>
        <h2 className={styles["sectionTitle"]}>One workspace, distinct responsibilities.</h2>
        <p className={styles["sectionLead"]}>
          Each person sees the work and actions appropriate to their role and tenant scope.
        </p>
      </div>
      <div className={styles["teamLine"]}>
        {TEAM.map((role) => (
          <span className={styles["teamRole"]} key={role.label}>
            <role.Icon size={15} strokeWidth={1.9} /> {role.label}
          </span>
        ))}
      </div>

      <div className={styles["architecture"]}>
        <article className={`${styles["plane"]} ${styles["controlPlane"]}`}>
          <span className={styles["planeIcon"]}>
            <LayersIcon size={22} strokeWidth={1.75} />
          </span>
          <p className={styles["planeEyebrow"]}>Control plane</p>
          <h3 className={styles["planeTitle"]}>Decide, govern, and account for every release.</h3>
          <p className={styles["planeCopy"]}>
            The administration console holds content, quality evidence, operations, releases, and
            audit data behind tenant and role checks.
          </p>
        </article>
        <article className={`${styles["plane"]} ${styles["servingPlane"]}`}>
          <span className={styles["planeIcon"]}>
            <GlobeIcon size={22} strokeWidth={1.75} />
          </span>
          <p className={styles["planeEyebrow"]}>Serving plane</p>
          <h3 className={styles["planeTitle"]}>Keep published sites fast and independent.</h3>
          <p className={styles["planeCopy"]}>
            Hosts read immutable release artifacts only. They continue serving without a database,
            queue, or AI dependency when the control plane is unavailable.
          </p>
        </article>
      </div>
    </section>

    <section className={styles["shell"]}>
      <div className={styles["finalCta"]}>
        <div>
          <h2 className={styles["finalTitle"]}>Ready to operate governed content?</h2>
          <p className={styles["finalCopy"]}>
            Enter the workspace to manage content, evidence, and releases.
          </p>
        </div>
        <a className={styles["finalAction"]} href="/admin">
          Open administration <span aria-hidden="true">→</span>
        </a>
      </div>
    </section>

    <footer className={`${styles["shell"]} ${styles["footer"]}`}>
      <GeoLogo />
      <p className={styles["footerCopy"]}>
        Governed production · Verified delivery · Full audit trail
      </p>
    </footer>
  </main>
)

export default RootPage
