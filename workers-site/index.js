import { getAssetFromKV, mapRequestToAsset } from '@cloudflare/kv-asset-handler'
import { Router } from 'itty-router'

// Create a new router
const router = Router()

const DEBUG = process.env.DEVELOPMENT;

// a generic error handler
const errorHandler = async (e, event) => {
  // if an error is thrown try to serve the asset at 404.html
  if (!DEBUG) {
    try {
      let notFoundResponse = await getAssetFromKV(event, {
        mapRequestToAsset: req => new Request(`${new URL(req.url).origin}/404.html`, req),
      })

      return new Response(notFoundResponse.body, { ...notFoundResponse, status: 404 })
    } catch (e) {}
  }

  return new Response(e.message || e.toString(), { status: 500 })
}

/**
 * readRequestBody reads in the incoming request body
 * Use await readRequestBody(..) in an async function to get the string
 * @param {Request} request the incoming request to read from
 */
 async function readRequestBody(request) {
  const { headers } = request
  const contentType = headers.get("content-type") || ""

  if (contentType.includes("application/json")) {
    return JSON.stringify(await request.json())
  }
  else if (contentType.includes("application/text")) {
    return await request.text()
  }
  else if (contentType.includes("text/html")) {
    return await request.text()
  }
  else if (contentType.includes("form")) {
    const formData = await request.formData()
    const body = {}
    for (const entry of formData.entries()) {
      body[entry[0]] = entry[1]
    }
    return JSON.stringify(body)
  }
  else {
    const myBlob = await request.blob()
    const objectURL = URL.createObjectURL(myBlob)
    return objectURL
  }
}

/*
This shows a different HTTP method, a POST.
Try send a POST request using curl or another tool.
Try the below curl command to send JSON:
$ curl -X POST <worker> -H "Content-Type: application/json" -d '{"abc": "def"}'
*/
router.post("/blog", async request => {
  const json = await readRequestBody(request);
  const body = JSON.parse(json); 

  await MY_KV.put(`blog:post:${body.slug}`, json);

  return new Response(json, {
    headers: {
      "Content-Type": "application/json"
    }
  })
})

router.get("/blog/all", async () => {
  const blogPostList = await MY_KV.list({ prefix: 'blog:post' });
  const blogPosts = (await Promise.all(blogPostList.keys.map(o => MY_KV.get(o.name, { type: 'json' }))))
  const modifiedBlogPosts = blogPosts.map(o => ({ ...o, new_field: 'hello :)' }))

  console.log(modifiedBlogPosts)

  return new Response(JSON.stringify(modifiedBlogPosts), {
    headers: {
      "Content-Type": "application/json"
    }
  })
})

router.get("/blog/:slug", async ({ params }) => {
  const blogPost = await MY_KV.get(`blog:post:${params.slug}`, { type: 'json' })
  const modifiedBlogPost = { ...blogPost, new_field: 'you fetched me :D' };

  return new Response(JSON.stringify(modifiedBlogPost), {
    headers: {
      "Content-Type": "application/json"
    }
  })
})

/*
Our index route, a simple hello world.
*/
router.get("*", async (_, event) => {
  let options = {}

  try {
    if (DEBUG) {
      // customize caching
      options.cacheControl = {
        bypassCache: true,
      }
    }

    const page = await getAssetFromKV(event, options)

    // allow headers to be altered
    const response = new Response(page.body, page)

    response.headers.set('X-XSS-Protection', '1; mode=block')
    response.headers.set('X-Content-Type-Options', 'nosniff')
    response.headers.set('X-Frame-Options', 'DENY')
    response.headers.set('Referrer-Policy', 'unsafe-url')
    response.headers.set('Feature-Policy', 'none')

    return response

  } catch (e) {
    errorHandler(e, event);
  }
})

/*
This is the last route we define, it will match anything that hasn't hit a route we've defined
above, therefore it's useful as a 404 (and avoids us hitting worker exceptions, so make sure to include it!).
Visit any page that doesn't exist (e.g. /foobar) to see it in action.
*/
router.all("*", (_, event) => {
  errorHandler(new Error('Missing route'), event);
})

/*
This snippet ties our worker to the router we deifned above, all incoming requests
are passed to the router where your routes are called and the response is sent.
*/
addEventListener('fetch', (event) => {
  event.respondWith(router.handle(event.request, event))
})