<template>
  <!-- First in the layout, so it is the first Tab stop. Tab to reveal it. -->
  <NeSkipLink />
  <nav aria-label="Example navigation">
    <a href="#overview">Overview</a>
    <a href="#alerts">Alerts</a>
  </nav>
  <!-- NE_MAIN_ID ('main-content') is auto-imported by the module. -->
  <main :id="NE_MAIN_ID">
    <p>The page. Enter on the skip link moves focus here, and the next Tab goes to:</p>
    <button type="button">First control in the page</button>
  </main>
</template>
