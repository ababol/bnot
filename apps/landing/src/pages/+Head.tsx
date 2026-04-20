export default function HeadDefault() {
  return (
    <>
      <link rel="icon" type="image/png" href={`${import.meta.env.BASE_URL}bnot-icon.png`} />
      <meta property="og:image" content={`${import.meta.env.BASE_URL}bnot-icon.png`} />
      <meta property="og:type" content="website" />
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
      <link
        href="https://fonts.googleapis.com/css2?family=Inter:wght@100..900&family=JetBrains+Mono:wght@400;500&display=swap"
        rel="stylesheet"
      />
    </>
  );
}
