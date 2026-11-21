// Open the topic menu on wide screens, keep it folded on phones.
// NOTE: Quartz's inline loader strips the first occurrence of the e-x-p-o-r-t
// keyword from this file, so that word must not appear anywhere in it.

const wide = window.matchMedia("(min-width: 801px)")

function setup() {
  for (const details of document.querySelectorAll<HTMLDetailsElement>(".topic-nav__toggle")) {
    details.open = wide.matches
    const closeOnPick = () => {
      if (!wide.matches) details.open = false
    }
    const links = details.querySelectorAll("a")
    for (const a of links) a.addEventListener("click", closeOnPick)
    const onChange = () => {
      details.open = wide.matches
    }
    wide.addEventListener("change", onChange)
    window.addCleanup(() => {
      for (const a of links) a.removeEventListener("click", closeOnPick)
      wide.removeEventListener("change", onChange)
    })
  }
}

const g = window as unknown as { __topicNavReady?: boolean }
if (!g.__topicNavReady) {
  g.__topicNavReady = true
  document.addEventListener("nav", setup)
}
