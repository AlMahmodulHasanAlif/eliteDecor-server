const express = require("express");
require("dotenv").config();
const cors = require("cors");
const app = express();
const port = process.env.PORT || 3000;
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

//middleware
app.use(cors());
app.use(express.json());

const uri = `mongodb+srv://${process.env.MONGO_USER}:${process.env.MONGO_PASS}@cluster0.ill4a2j.mongodb.net/?appName=Cluster0`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});
async function run() {
  try {
    const database = client.db("eliteDecorDB");
    const servicesCollection = database.collection("services");
    const usersCollection = database.collection("users");

    // Get all services with optional limit
    app.get("/services", async (req, res) => {
      const { limit, search, category, sort } = req.query;
      const query = {};
      if (search) {
        query.service_name = { $regex: search, $options: "i" };
      }
      if (category) {
        query.service_category = category;
      }

      let sortOption = { createdAt: -1 };
      if (sort === "price_asc") sortOption = { cost: 1 };
      else if (sort === "price_desc") sortOption = { cost: -1 };

      let cursor = servicesCollection.find(query).sort(sortOption);

      if (limit) {
        cursor = cursor.limit(parseInt(limit));
      }

      const services = await cursor.toArray();
      res.send(services);
    });
    //services details
    app.get("/services/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await servicesCollection.findOne(query);
      res.send(result);
    });

    app.get("/decorators/top", async (req, res) => {
      const { limit } = req.query;
      const query = {
        role: "decorator",
        "decoratorInfo.status": "active",
      };

      let cursor = usersCollection
        .find(query)
        .sort({ "decoratorInfo.rating": -1 });

      if (limit) {
        cursor = cursor.limit(parseInt(limit));
      }

      const topDecorators = await cursor.toArray();
      res.send(topDecorators);
    });

    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();
    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Hello World!");
});

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});
