<head-bottom>
  <link rel="stylesheet" href="{{baseUrl}}/css/site.css">
</head-bottom>

<header sticky>
  <navbar type="dark">
    <a slot="brand" href="{{baseUrl}}/index.html" title="FreshApples home" class="navbar-brand">FreshApples</a>
    <li><a href="{{baseUrl}}/UserGuide.html" class="nav-link">User Guide</a></li>
    <li><a href="{{baseUrl}}/DeveloperGuide.html" class="nav-link">Developer Guide</a></li>
    <li><a href="{{baseUrl}}/Reflections.html" class="nav-link">Reflections</a></li>
    <li><a href="{{baseUrl}}/releases.html" class="nav-link">Releases</a></li>
    <li><a href="https://github.com/CS3227-2610-MP3-FreshApples/CS3227-2610-MP3" class="nav-link"><md>:fab-github:</md></a></li>
    <li slot="right">
      <form class="navbar-form">
        <searchbar :data="searchData" placeholder="Search" :on-hit="searchCallback" menu-align-right></searchbar>
      </form>
    </li>
  </navbar>
</header>

<main class="container py-4">
  {{ content }}
</main>

<footer class="border-top mt-5 py-4 text-center text-muted">
  FreshApples Product Documentation
</footer>
