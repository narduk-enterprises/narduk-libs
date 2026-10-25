<template>
  <!-- A transformed frame is the bar's containing block, so this demo pins to
       the frame. In a page, drop the frame and the bar pins to the phone. -->
  <div
    class="relative h-44 w-full max-w-sm overflow-hidden rounded border border-default"
    style="transform: translate(0)"
  >
    <p class="m-3 text-sm">Last row of the page</p>
    <NeStickyActionBar label="Trade actions" :phone-only="false">
      <UButton class="flex-1 justify-center" color="neutral" variant="outline">Sell</UButton>
      <UButton class="flex-1 justify-center">Buy</UButton>
    </NeStickyActionBar>
  </div>
</template>
